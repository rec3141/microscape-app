import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createReadStream, statSync } from 'fs';
import { resolve, sep, extname } from 'path';
import { Readable } from 'stream';
import { getDb } from '$lib/server/db';
import { requireUser } from '$lib/server/guards';

/**
 * Gated file endpoint for a single run. Access is checked with the same
 * rule as the landing page (`public OR lab member OR run_access`).
 *
 * In production, the happy path emits `X-Accel-Redirect` into an nginx
 * `internal` location pointed at `RUNS_ROOT` — nginx does the byte
 * delivery so Node never has to stream multi-GB files. In dev (or when
 * `RUNS_ROOT` / `X_ACCEL_PREFIX` aren't configured) the handler falls
 * back to streaming via the Node filesystem.
 *
 * Path safety: the resolved filesystem path is required to be inside
 * `run.data_path`, and `run.data_path` itself is required to be inside
 * `RUNS_ROOT` when that env var is set. Symlink-escape is mitigated by
 * `fs.realpathSync`-like canonicalization via `path.resolve` — combined
 * with the prefix check this closes both `..` traversal and symlinks
 * pointing outside the tree (but see fs.realpath below if stricter
 * enforcement is needed against TOCTOU-style symlink swaps).
 */

// Minimal content-type map. The browser sniffs fallback for unknown
// extensions; keeping this list tight avoids false-confidence typing for
// arbitrary pipeline outputs.
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

export const GET: RequestHandler = async ({ params, locals, request }) => {
	const user = requireUser(locals);
	const db = getDb();

	// Visibility: same three-way OR as the landing query. A miss returns
	// 404 rather than 403 so the existence of the run isn't leaked to a
	// caller who doesn't hold any of the grants.
	const run = db.prepare(
		`SELECT r.id, r.data_path, r.is_public
		 FROM runs r
		 LEFT JOIN lab_memberships m
		   ON m.lab_id = r.lab_id AND m.user_id = ? AND m.status = 'active'
		 LEFT JOIN run_access ra
		   ON ra.run_id = r.id AND ra.user_id = ?
		 WHERE r.id = ?
		   AND (r.is_public = 1 OR m.user_id IS NOT NULL OR ra.user_id IS NOT NULL)`
	).get(user.id, user.id, params.id) as
		| { id: string; data_path: string; is_public: number }
		| undefined;
	if (!run) throw error(404, 'Not found');

	// Root enforcement: if RUNS_ROOT is set, refuse runs whose data_path
	// escapes it. This is a belt-and-suspenders check — run registration
	// already enforces absolute-path shape, but RUNS_ROOT is the nginx-
	// alias root so we must not serve anything outside it.
	const runsRoot = env.RUNS_ROOT ? resolve(env.RUNS_ROOT) : null;
	const dataPath = resolve(run.data_path);
	if (runsRoot && !isUnder(dataPath, runsRoot)) {
		console.error('[files] run.data_path', dataPath, 'escapes RUNS_ROOT', runsRoot);
		throw error(404, 'Not found');
	}

	// Resolve the requested subpath against data_path, then refuse if the
	// resolved path leaves data_path. `params.subpath` is SvelteKit's rest
	// match: zero-or-more url segments joined with "/". Empty → serve
	// the run's index.html; trailing slash → same.
	let sub = params.subpath ?? '';
	if (sub === '' || sub.endsWith('/')) sub += 'index.html';
	const target = resolve(dataPath, sub);
	if (!isUnder(target, dataPath)) throw error(404, 'Not found');

	// Stat first — produces a clean 404 on missing rather than a broken
	// stream. ENOENT is by far the common case; other errors (permission,
	// broken symlink) are logged and returned as 404 to avoid leaking
	// filesystem details to the client.
	let stat;
	try {
		stat = statSync(target);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== 'ENOENT') console.error('[files] stat', target, code);
		throw error(404, 'Not found');
	}
	if (!stat.isFile()) throw error(404, 'Not found');

	// Production happy-path: emit X-Accel-Redirect so nginx serves the
	// bytes from its internal location. The URI path is (target minus
	// RUNS_ROOT) — nginx's `alias RUNS_ROOT/` resolves that back to the
	// same file on disk.
	const xAccelPrefix = env.X_ACCEL_PREFIX; // e.g. '/_protected/'
	if (xAccelPrefix && runsRoot) {
		const rel = target.slice(runsRoot.length).replace(/^\/+/, '');
		// URI-encode each segment so spaces / non-ascii filenames survive.
		const uri =
			xAccelPrefix.replace(/\/+$/, '') +
			'/' +
			rel.split('/').map(encodeURIComponent).join('/');
		return new Response(null, {
			status: 200,
			headers: {
				'X-Accel-Redirect': uri,
				// Content-Type + cache hints hint to nginx the outbound
				// headers. nginx can override from its own mime types, but
				// this keeps behavior consistent across fallback + proxy.
				'Content-Type': contentType(target),
				'Cache-Control': run.is_public ? 'public, max-age=300' : 'private, max-age=0'
			}
		});
	}

	// Dev fallback: stream the file directly from Node. Good enough for
	// local work; not suitable for multi-GB production downloads.
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

/** True iff `child` is exactly `parent` or a descendant path. Uses the
 *  resolved (canonical) paths and appends a separator to rule out
 *  prefix-sibling matches like `/data/web/microscape.app2`. */
function isUnder(child: string, parent: string): boolean {
	if (child === parent) return true;
	return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}
