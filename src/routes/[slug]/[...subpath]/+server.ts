import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createReadStream, statSync } from 'fs';
import { resolve, sep, extname } from 'path';
import { Readable } from 'stream';
import { getDb } from '$lib/server/db';
import { requireUser } from '$lib/server/guards';

/**
 * Slug-based alias for /runs/[id]/files/[...subpath].
 *
 * Lab viz SPAs are typically built with an absolute base path matching the
 * run's slug (e.g. `base: "/chesterfield/"`), so asset URLs emitted by the
 * build reference `/chesterfield/assets/...`. Serving them behind the
 * canonical `/runs/<id>/files/` URL breaks those absolute references. This
 * route catches the slug at the root and dispatches to the same ACL-gated
 * file delivery — letting existing SPAs work unchanged.
 *
 * Resolution: find the run whose slug matches AND the caller has access to.
 * When multiple labs share a slug, prefer the caller's active lab, then any
 * lab they're a member of, then public runs elsewhere.
 *
 * Slug collisions with top-level app routes are prevented at run registration
 * time by the RESERVED_SLUGS list in schemas/runs.ts. SvelteKit's route
 * ordering also ensures a more-specific route (e.g. /settings) always wins
 * over this catch-all.
 */

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.mjs': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.tsv': 'text/tab-separated-values; charset=utf-8',
	'.csv': 'text/csv; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.svg': 'image/svg+xml',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.gz': 'application/gzip'
};

function contentType(path: string): string {
	return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function isUnder(child: string, parent: string): boolean {
	if (child === parent) return true;
	return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

export const GET: RequestHandler = async ({ params, locals }) => {
	const user = requireUser(locals);
	const db = getDb();

	// Resolve slug → run, preferring: active lab > any member lab > explicit
	// cross-lab grant > public. `run_access` grant beats `public` because an
	// explicit grant is a stronger signal of intent than the public flag.
	const run = db.prepare(
		`SELECT r.id, r.data_path, r.is_public
		 FROM runs r
		 LEFT JOIN lab_memberships m
		   ON m.lab_id = r.lab_id AND m.user_id = ? AND m.status = 'active'
		 LEFT JOIN run_access ra
		   ON ra.run_id = r.id AND ra.user_id = ?
		 WHERE r.slug = ?
		   AND (r.is_public = 1 OR m.user_id IS NOT NULL OR ra.user_id IS NOT NULL)
		 ORDER BY
		   CASE WHEN r.lab_id = ? THEN 0 ELSE 1 END,
		   CASE
		     WHEN m.user_id IS NOT NULL THEN 0
		     WHEN ra.user_id IS NOT NULL THEN 1
		     ELSE 2
		   END,
		   r.created_at DESC
		 LIMIT 1`
	).get(user.id, user.id, params.slug, user.lab_id ?? '') as
		| { id: string; data_path: string; is_public: number }
		| undefined;
	if (!run) throw error(404, 'Not found');

	const runsRoot = env.RUNS_ROOT ? resolve(env.RUNS_ROOT) : null;
	const dataPath = resolve(run.data_path);
	if (runsRoot && !isUnder(dataPath, runsRoot)) {
		console.error('[files] run.data_path', dataPath, 'escapes RUNS_ROOT', runsRoot);
		throw error(404, 'Not found');
	}

	let sub = params.subpath ?? '';
	if (sub === '' || sub.endsWith('/')) sub += 'index.html';
	const target = resolve(dataPath, sub);
	if (!isUnder(target, dataPath)) throw error(404, 'Not found');

	let stat;
	try {
		stat = statSync(target);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== 'ENOENT') console.error('[files] stat', target, code);
		throw error(404, 'Not found');
	}
	if (!stat.isFile()) throw error(404, 'Not found');

	const xAccelPrefix = env.X_ACCEL_PREFIX;
	if (xAccelPrefix && runsRoot) {
		const rel = target.slice(runsRoot.length).replace(/^\/+/, '');
		const uri =
			xAccelPrefix.replace(/\/+$/, '') +
			'/' +
			rel.split('/').map(encodeURIComponent).join('/');
		return new Response(null, {
			status: 200,
			headers: {
				'X-Accel-Redirect': uri,
				'Content-Type': contentType(target),
				'Cache-Control': run.is_public ? 'public, max-age=300' : 'private, max-age=0'
			}
		});
	}

	const stream = createReadStream(target);
	const body = Readable.toWeb(stream) as ReadableStream;
	return new Response(body, {
		status: 200,
		headers: {
			'Content-Type': contentType(target),
			'Content-Length': String(stat.size),
			'Cache-Control': run.is_public ? 'public, max-age=300' : 'private, max-age=0',
			'Last-Modified': stat.mtime.toUTCString()
		}
	});
};
