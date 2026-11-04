import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { existsSync, readFileSync, statSync } from 'fs';
import { resolve, sep } from 'path';
import { createHash } from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';
import { findAccessibleRun } from '$lib/server/run-access';

/**
 * One run's ASVs for the EarthDNA globe, slimmed to what the page draws.
 *
 * The run's data/globe.json(.gz) (PLACE_GLOBE positions) joined to its
 * data/asvs.json(.gz) (read counts, taxonomy). asvs.json also carries every
 * sequence and the run's own t-SNE coordinates, several times the size of what
 * the globe needs, so the page asks here instead of fetching both files.
 *
 *   { reference, regions, taxa, asvs: [[id, lon, lat, region, reads, samples, taxon], ...] }
 *
 * region and taxon index regions and taxa. Built on first request and kept
 * (gzipped) until either source file changes. Access is the gated file route's.
 */

interface Entry {
	key: string;
	gz: Buffer;
}
const cache = new Map<string, Entry>();

function isUnder(child: string, parent: string): boolean {
	return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

// the gzipped copy when the bundle has one, as the pipeline usually ships them
function source(dir: string, name: string): string | null {
	for (const f of [`${name}.gz`, name]) {
		const p = resolve(dir, f);
		if (existsSync(p)) return p;
	}
	return null;
}

function readJson(path: string): unknown {
	const raw = readFileSync(path);
	return JSON.parse((path.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8'));
}

interface Globe {
	fields: string[];
	regions: string[];
	reference: unknown;
	asvs: (string | number)[][];
}
interface AsvInfo {
	id: string;
	total_reads?: number;
	n_samples?: number;
	taxonomy?: string;
}

function build(globePath: string, asvsPath: string | null): Buffer {
	const globe = readJson(globePath) as Globe;
	const info = asvsPath ? (readJson(asvsPath) as AsvInfo[]) : [];
	const byId = new Map(info.map((a) => [a.id, a]));
	const f = (name: string) => globe.fields.indexOf(name);
	const [cId, cLon, cLat, cReg] = [f('id'), f('lon'), f('lat'), f('region')];
	const taxa: string[] = [];
	const taxIx = new Map<string, number>();
	const asvs = globe.asvs.map((row) => {
		const a = byId.get(row[cId] as string);
		const t = a?.taxonomy ?? '';
		let k = taxIx.get(t);
		if (k === undefined) {
			k = taxa.length;
			taxIx.set(t, k);
			taxa.push(t);
		}
		return [row[cId], row[cLon], row[cLat], row[cReg], a?.total_reads ?? 0, a?.n_samples ?? 0, k];
	});
	return gzipSync(JSON.stringify({ reference: globe.reference, regions: globe.regions, taxa, asvs }));
}

export const GET: RequestHandler = async ({ params, locals, request }) => {
	const run = findAccessibleRun(locals.user ?? null, params.id);
	if (!run) throw error(404, 'Not found');
	const dataPath = resolve(run.data_path);
	const runsRoot = env.RUNS_ROOT ? resolve(env.RUNS_ROOT) : null;
	if (runsRoot && !isUnder(dataPath, runsRoot)) throw error(404, 'Not found');

	const dir = resolve(dataPath, 'data');
	const globePath = source(dir, 'globe.json');
	if (!globePath) throw error(404, 'Not found');
	const asvsPath = source(dir, 'asvs.json');

	const key = [globePath, asvsPath].map((p) => (p ? `${p}:${statSync(p).mtimeMs}` : '-')).join('|');
	let entry = cache.get(run.id);
	if (!entry || entry.key !== key) {
		entry = { key, gz: build(globePath, asvsPath) };
		cache.set(run.id, entry);
	}

	const etag = `"${createHash('sha1').update(entry.key).digest('base64url')}"`;
	const headers: Record<string, string> = {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'private, no-cache',
		ETag: etag,
		Vary: 'Accept-Encoding'
	};
	if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
	if (/\bgzip\b/.test(request.headers.get('accept-encoding') ?? '')) {
		return new Response(new Uint8Array(entry.gz), { headers: { ...headers, 'Content-Encoding': 'gzip' } });
	}
	return new Response(new Uint8Array(gunzipSync(entry.gz)), { headers });
};
