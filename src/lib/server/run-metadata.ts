import { gzipSync, gunzipSync } from 'zlib';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getDb } from '$lib/server/db';

/**
 * Admin-uploaded sample metadata (table `run_metadata`). When a run has a
 * row, the file endpoints answer the viz's `data/metadata.json` fetch from
 * here instead of the bundle on disk, so metadata survives redeploys and
 * reaches every viewer without a per-browser upload.
 */

export interface RunMetadataRow {
	run_id: string;
	filename: string;
	content: string;
	sample_count: number;
	uploaded_by: string | null;
	uploaded_at: string;
}

/** Sub-paths the viz may request for metadata. It tries `.gz` first. */
const METADATA_PATHS = new Set(['data/metadata.json', 'data/metadata.json.gz']);

export function getRunMetadata(runId: string): RunMetadataRow | undefined {
	return getDb().prepare('SELECT * FROM run_metadata WHERE run_id = ?').get(runId) as
		| RunMetadataRow
		| undefined;
}

/**
 * Return the override response for a metadata sub-path, or null to fall
 * through to the on-disk file. The `.gz` URL is answered with gzip bytes and
 * `Content-Encoding: gzip`, matching how serveRunFile labels pre-compressed
 * files, so the viz's `.gz`-first fetch decodes it transparently.
 */
export function metadataOverrideResponse(
	runId: string,
	subpath: string,
	visibility: string
): Response | null {
	if (!METADATA_PATHS.has(subpath)) return null;
	const row = getRunMetadata(runId);
	if (!row) return null;

	const cacheable = visibility === 'public' || visibility === 'shared';
	const headers: Record<string, string> = {
		'Content-Type': 'application/json; charset=utf-8',
		// Revalidate every time — an admin re-upload should show up on the
		// next page load, not after a max-age window.
		'Cache-Control': cacheable ? 'public, no-cache' : 'private, no-cache',
		'Last-Modified': new Date(row.uploaded_at.replace(' ', 'T') + 'Z').toUTCString(),
		Vary: 'Accept-Encoding'
	};
	if (subpath.endsWith('.gz')) {
		headers['Content-Encoding'] = 'gzip';
		return new Response(gzipSync(row.content), { status: 200, headers });
	}
	return new Response(row.content, { status: 200, headers });
}

/**
 * Sample ids (FLOWCELL:barcodeNN) the run's bundle knows about, read from
 * `<data_path>/data/samples.json` or its `.gz` sibling. Null when the bundle
 * has no readable samples list.
 */
export function readRunSampleIds(dataPath: string): Set<string> | null {
	const base = join(dataPath, 'data', 'samples.json');
	for (const [path, gz] of [[base, false], [base + '.gz', true]] as const) {
		let buf: Buffer;
		try {
			buf = readFileSync(path);
		} catch {
			continue;
		}
		try {
			const parsed = JSON.parse((gz ? gunzipSync(buf) : buf).toString('utf8'));
			if (!Array.isArray(parsed)) return null;
			return new Set(
				parsed.map((s) => s?.id).filter((id): id is string => typeof id === 'string')
			);
		} catch (err) {
			console.error('[run-metadata] unreadable', path, err);
			return null;
		}
	}
	return null;
}

/** True when the bundle ships its own metadata.json(.gz). */
export function bundleHasMetadata(dataPath: string): boolean {
	const base = join(dataPath, 'data', 'metadata.json');
	return existsSync(base) || existsSync(base + '.gz');
}
