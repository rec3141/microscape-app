import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { mkdtemp, rm, stat } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { env } from '$env/dynamic/private';
import { getDb, generateId } from '$lib/server/db';
import { authenticateApiKey, extractBearer } from '$lib/server/api-keys';
import { RunCreateBody } from '$lib/server/schemas/runs';
import { apiError } from '$lib/server/api-errors';

/**
 * POST /api/v1/deploy — ingest a run from an external pipeline.
 *
 * Auth: `Authorization: Bearer mk_...` (lab-scoped API key). Session
 * cookies are NOT honored here — this endpoint is in the public-api
 * allowlist in hooks.server.ts precisely so Bearer tokens can reach it.
 *
 * Metadata in headers (one request, no sidecar upload):
 *   X-Microscape-Slug         required — URL-safe run slug
 *   X-Microscape-Pipeline     required — pipeline slug (e.g. danaseq-nanopore-live)
 *   X-Microscape-Name         optional — display name (defaults to slug)
 *   X-Microscape-Description  optional
 *   X-Microscape-Public       optional — "1" to mark is_public
 *
 * Body: a `.tar.gz` whose root contents will become the run directory.
 * Shape the tarball with a flat root (`index.html`, `assets/`, `data/`),
 * NOT wrapped in an extra top-level directory:
 *     cd <run_dir> && tar -czf - .
 *
 * Flow:
 *   1. Authenticate + extract lab_id from the key.
 *   2. Validate slug / pipeline via the same zod schema as manual runs.
 *   3. Extract the stream to a fresh temp dir under INGEST_TMP.
 *   4. rsync --delete into RUNS_ROOT/<slug>/ for a near-atomic swap.
 *   5. Upsert the `runs` row pointing at the final path.
 *   6. Clean up the temp dir.
 *
 * On any error before rsync, the old run directory is untouched. On an
 * rsync mid-stream failure the target can be partially updated — rsync
 * itself writes through temp files per entry, so most partials are
 * recoverable, but we surface the error to the caller so the pipeline
 * knows to retry.
 */

const INGEST_TMP = env.INGEST_TMP || '/data/tmp';

export const POST: RequestHandler = async ({ request }) => {
	const token = extractBearer(request.headers.get('authorization'));
	if (!token) return json({ error: 'Missing Authorization: Bearer <key>' }, { status: 401 });

	const auth = authenticateApiKey(token);
	if (!auth) return json({ error: 'Invalid or revoked API key' }, { status: 401 });

	const slug = request.headers.get('x-microscape-slug')?.trim();
	const pipelineSlug = request.headers.get('x-microscape-pipeline')?.trim();
	const name = (request.headers.get('x-microscape-name') || slug || '').trim();
	const description = request.headers.get('x-microscape-description')?.trim() || null;
	const isPublic = request.headers.get('x-microscape-public') === '1' ? 1 : 0;

	if (!slug) return json({ error: 'Missing X-Microscape-Slug' }, { status: 400 });
	if (!pipelineSlug) return json({ error: 'Missing X-Microscape-Pipeline' }, { status: 400 });

	// Reuse the run-create zod schema for slug validation — catches reserved
	// words, regex, and length in one place.
	const validation = RunCreateBody.safeParse({
		pipeline_id: '0'.repeat(32), // placeholder; we validate pipeline_slug below
		slug,
		name,
		data_path: '/dev/null', // placeholder; set for real after extraction
		is_public: isPublic
	});
	if (!validation.success) {
		const slugIssue = validation.error.issues.find((i) => i.path[0] === 'slug');
		if (slugIssue) {
			return json({ error: `Invalid slug: ${slugIssue.message}` }, { status: 400 });
		}
	}

	const db = getDb();
	const pipeline = db
		.prepare('SELECT id FROM pipelines WHERE slug = ?')
		.get(pipelineSlug) as { id: string } | undefined;
	if (!pipeline) return json({ error: `Unknown pipeline: ${pipelineSlug}` }, { status: 400 });

	const runsRoot = env.RUNS_ROOT ? resolve(env.RUNS_ROOT) : null;
	if (!runsRoot) {
		console.error('[deploy] RUNS_ROOT not configured');
		return json({ error: 'Server misconfigured: RUNS_ROOT unset' }, { status: 500 });
	}

	const targetDir = resolve(runsRoot, slug);
	if (!isUnder(targetDir, runsRoot)) {
		// Defense against slug values that sneak past the zod check.
		return json({ error: 'Invalid slug' }, { status: 400 });
	}

	if (!request.body) return json({ error: 'Empty body' }, { status: 400 });

	const ingestId = generateId();
	let tmpDir: string | null = null;
	try {
		tmpDir = await mkdtemp(join(INGEST_TMP, `microscape-ingest-${ingestId}-`));

		await extractTarGz(request.body, tmpDir);

		// Extraction shape detection: if the tarball wrapped everything in a
		// single top-level directory (a common `tar -czf foo.tgz foo/`
		// pattern), use that dir's contents rather than the tmp dir itself.
		const { children, entries } = await readTopLevel(tmpDir);
		const sourceDir =
			entries.length === 1 && (await stat(join(tmpDir, entries[0]))).isDirectory()
				? join(tmpDir, entries[0])
				: tmpDir;

		await rsyncMirror(sourceDir, targetDir);

		// Upsert the run row. ON CONFLICT bumps the record so a second
		// deploy to the same slug updates in place.
		db.prepare(
			`INSERT INTO runs (lab_id, pipeline_id, slug, name, description, data_path, is_public)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(lab_id, slug) DO UPDATE SET
			   pipeline_id = excluded.pipeline_id,
			   name        = excluded.name,
			   description = COALESCE(excluded.description, runs.description),
			   data_path   = excluded.data_path,
			   is_public   = excluded.is_public,
			   updated_at  = datetime('now')`
		).run(auth.lab_id, pipeline.id, slug, name, description, targetDir, isPublic);

		const run = db
			.prepare('SELECT id FROM runs WHERE lab_id = ? AND slug = ?')
			.get(auth.lab_id, slug) as { id: string };

		const origin = env.ORIGIN?.replace(/\/+$/, '') || '';
		return json({
			run_id: run.id,
			slug,
			url: `${origin}/${slug}/`,
			files: children
		});
	} catch (err) {
		console.error('[deploy] failed', err);
		return apiError(err, 500);
	} finally {
		if (tmpDir) {
			rm(tmpDir, { recursive: true, force: true }).catch(() => {});
		}
	}
};

/** Pipe a Web ReadableStream into `tar -xzf - -C <tmpDir>`. Rejects
 *  absolute paths in the archive (tar does this by default with
 *  --no-absolute-filenames, restated here for clarity). */
function extractTarGz(body: ReadableStream<Uint8Array>, tmpDir: string): Promise<void> {
	return new Promise((resolveP, rejectP) => {
		const proc = spawn(
			'tar',
			['--no-same-owner', '--no-absolute-filenames', '-xzf', '-', '-C', tmpDir],
			{ stdio: ['pipe', 'ignore', 'pipe'] }
		);
		let stderr = '';
		proc.stderr.on('data', (c) => {
			stderr += c.toString();
			if (stderr.length > 4000) stderr = stderr.slice(0, 4000);
		});
		proc.on('error', rejectP);
		proc.on('close', (code) => {
			if (code === 0) resolveP();
			else rejectP(new Error(`tar exited ${code}: ${stderr.trim() || 'unknown'}`));
		});

		const nodeIn = Readable.fromWeb(body as unknown as import('stream/web').ReadableStream<Uint8Array>);
		nodeIn.on('error', (err) => {
			proc.stdin.destroy();
			rejectP(err);
		});
		nodeIn.pipe(proc.stdin);
	});
}

/** Mirror `src/` -> `dst/` with deletes. Counts file entries on the way
 *  so the response can surface a useful "X files deployed" summary. */
async function rsyncMirror(src: string, dst: string): Promise<void> {
	return new Promise((resolveP, rejectP) => {
		// Trailing slash on src is important — copies contents, not the dir.
		const proc = spawn('rsync', ['-a', '--delete', `${src}/`, `${dst}/`], {
			stdio: ['ignore', 'ignore', 'pipe']
		});
		let stderr = '';
		proc.stderr.on('data', (c) => {
			stderr += c.toString();
			if (stderr.length > 4000) stderr = stderr.slice(0, 4000);
		});
		proc.on('error', rejectP);
		proc.on('close', (code) => {
			if (code === 0) resolveP();
			else rejectP(new Error(`rsync exited ${code}: ${stderr.trim() || 'unknown'}`));
		});
	});
}

/** Count files under a directory and return its top-level entries. */
async function readTopLevel(dir: string): Promise<{ children: number; entries: string[] }> {
	const { readdir } = await import('fs/promises');
	const entries = await readdir(dir);
	let children = 0;
	// Shell out to find for a fast recursive count — much cheaper than
	// walking with node fs for a large tree.
	await new Promise<void>((resolveP, rejectP) => {
		const proc = spawn('find', [dir, '-type', 'f'], { stdio: ['ignore', 'pipe', 'ignore'] });
		proc.stdout.on('data', (c: Buffer) => {
			children += c.toString().split('\n').filter(Boolean).length;
		});
		proc.on('error', rejectP);
		proc.on('close', () => resolveP());
	});
	return { children, entries };
}

function isUnder(child: string, parent: string): boolean {
	if (child === parent) return true;
	return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}
