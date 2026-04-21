import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createReadStream, statSync, type ReadStream } from 'fs';
import { resolve, sep, extname } from 'path';

/**
 * Resolve a subpath under a run's data_path and return an HTTP response.
 *
 * Happy-path: emit `X-Accel-Redirect` into the internal nginx location so
 * nginx delivers the bytes. When `X_ACCEL_PREFIX` / `RUNS_ROOT` aren't set
 * (local dev), stream via `fs.createReadStream` instead.
 *
 * Transparent `.gz` fallback: when the client accepts gzip and the target
 * file doesn't exist but `<target>.gz` does, serve that file with
 * `Content-Encoding: gzip`. This replicates nginx's `gzip_static on`
 * behavior and is required because viz data is shipped pre-compressed
 * (data/read_explorer.json.gz etc.) and the SPA fetches the uncompressed
 * name with `Accept-Encoding: gzip` expecting the server to substitute.
 *
 * Path safety: the resolved filesystem path is required to be inside
 * `run.data_path`, and `run.data_path` itself is required to be inside
 * `RUNS_ROOT` when that env var is set.
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

function contentTypeFor(path: string): string {
	return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolve the logical content-type + transport encoding for a path.
 *
 * When the file ends in `.X.gz` where `.X` is a known type (e.g. .json.gz,
 * .tsv.gz, .html.gz), treat it as `X` content with `Content-Encoding: gzip`
 * — the browser will decode transparently and callers using
 * `response.json()` / `response.text()` get the real content.
 *
 * When the inner extension is NOT known (e.g. `.tar.gz`, `.bam.gz`, a bare
 * `.gz` with no inner hint), return `application/gzip` and no encoding —
 * the client gets raw gzipped bytes and can save/download as-is.
 */
function resolveContent(path: string): { contentType: string; contentEncoding: string | null } {
	const lower = path.toLowerCase();
	if (lower.endsWith('.gz')) {
		const inner = lower.slice(0, -3);
		const innerExt = extname(inner);
		if (innerExt && MIME[innerExt] && innerExt !== '.gz') {
			return { contentType: MIME[innerExt], contentEncoding: 'gzip' };
		}
		return { contentType: 'application/gzip', contentEncoding: null };
	}
	return { contentType: MIME[extname(lower)] ?? 'application/octet-stream', contentEncoding: null };
}

function isUnder(child: string, parent: string): boolean {
	if (child === parent) return true;
	return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

function acceptsGzip(headerValue: string | null): boolean {
	if (!headerValue) return false;
	// Cheap accept-encoding check — handles the common `gzip`, `gzip, deflate`,
	// and the rare `gzip;q=0` opt-out.
	return /(?:^|,\s*)gzip(?:\s*;\s*q=0(?:\.0+)?\b)?/i.test(headerValue) &&
		!/(?:^|,\s*)gzip\s*;\s*q=0(?:\.0+)?\b/i.test(headerValue);
}

interface Stat {
	size: number;
	mtime: Date;
}

/**
 * Adapt a Node fs.ReadStream to a Web ReadableStream, swallowing
 * double-close races on the controller. Node 18's built-in
 * `Readable.toWeb()` throws ERR_INVALID_STATE when the underlying
 * ReadStream's 'close' event fires after the controller already closed
 * via end/error, which crashes the whole worker.
 */
function nodeStreamToWebReadable(nodeStream: ReadStream): ReadableStream {
	let closed = false;
	return new ReadableStream({
		start(controller) {
			nodeStream.on('data', (chunk) => {
				if (closed) return;
				try { controller.enqueue(chunk); } catch { /* controller already closed */ }
			});
			nodeStream.once('end', () => {
				if (closed) return;
				closed = true;
				try { controller.close(); } catch { /* already closed */ }
			});
			nodeStream.once('error', (err) => {
				if (closed) return;
				closed = true;
				try { controller.error(err); } catch { /* already closed */ }
			});
		},
		cancel(reason) {
			closed = true;
			nodeStream.destroy(reason instanceof Error ? reason : undefined);
		}
	});
}

function safeStat(path: string): Stat | null {
	try {
		const s = statSync(path);
		if (!s.isFile()) return null;
		return { size: s.size, mtime: s.mtime };
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code && code !== 'ENOENT') console.error('[serve-run-file] stat', path, code);
		return null;
	}
}

export function serveRunFile(
	run: { data_path: string; is_public: number },
	subpath: string,
	headers: { acceptEncoding: string | null }
): Response {
	const runsRoot = env.RUNS_ROOT ? resolve(env.RUNS_ROOT) : null;
	const dataPath = resolve(run.data_path);
	if (runsRoot && !isUnder(dataPath, runsRoot)) {
		console.error('[serve-run-file] run.data_path', dataPath, 'escapes RUNS_ROOT', runsRoot);
		throw error(404, 'Not found');
	}

	let sub = subpath ?? '';
	if (sub === '' || sub.endsWith('/')) sub += 'index.html';
	const target = resolve(dataPath, sub);
	if (!isUnder(target, dataPath)) throw error(404, 'Not found');

	// Locate the file. One fallback: if the bare target is missing and the
	// client accepts gzip, serve `target.gz` as the logical type with
	// Content-Encoding: gzip. This replicates nginx's `gzip_static` so a
	// client asking for `foo.json` gets the pre-compressed `foo.json.gz`
	// transparently. (The reverse — substituting plain for a .gz request
	// — is the lab's job: ship data files pre-gzipped.)
	let served = target;
	let stat = safeStat(target);
	let resolved = resolveContent(target);
	if (!stat && acceptsGzip(headers.acceptEncoding)) {
		const gz = target + '.gz';
		const gzStat = safeStat(gz);
		if (gzStat) {
			served = gz;
			stat = gzStat;
			resolved = { contentType: resolved.contentType, contentEncoding: 'gzip' };
		}
	}
	if (!stat) throw error(404, 'Not found');

	const ct = resolved.contentType;
	const contentEncoding = resolved.contentEncoding;
	const cacheControl = run.is_public ? 'public, max-age=300' : 'private, max-age=0';

	// Production happy-path: emit X-Accel-Redirect and let nginx serve the
	// bytes. BUT: nginx's X-Accel flow strips upstream Content-Encoding
	// (it treats the internal response as a fresh static-file serve, and
	// its own gzip module either re-compresses or drops the header), so
	// when we need Content-Encoding on the wire — i.e. for pre-compressed
	// `.gz` content we're labeling as the uncompressed type — we have to
	// stream from Node. For plain files we still hand off to nginx.
	const xAccelPrefix = env.X_ACCEL_PREFIX;
	if (xAccelPrefix && runsRoot && !contentEncoding) {
		const rel = served.slice(runsRoot.length).replace(/^\/+/, '');
		const uri =
			xAccelPrefix.replace(/\/+$/, '') +
			'/' +
			rel.split('/').map(encodeURIComponent).join('/');
		return new Response(null, {
			status: 200,
			headers: {
				'X-Accel-Redirect': uri,
				'Content-Type': ct,
				'Cache-Control': cacheControl,
				Vary: 'Accept-Encoding'
			}
		});
	}

	// Stream the file from Node. Used in dev (no nginx) and in prod for
	// responses that need a Content-Encoding header (pre-compressed .gz).
	// We hand-roll the Web stream adapter instead of using Readable.toWeb
	// because the Node 18 built-in hits ERR_INVALID_STATE when the
	// underlying ReadStream close fires after the controller has already
	// been closed — a race that reliably kills the worker on small files.
	const body = nodeStreamToWebReadable(createReadStream(served));
	const h: Record<string, string> = {
		'Content-Type': ct,
		'Content-Length': String(stat.size),
		'Cache-Control': cacheControl,
		'Last-Modified': stat.mtime.toUTCString(),
		Vary: 'Accept-Encoding'
	};
	if (contentEncoding) h['Content-Encoding'] = contentEncoding;
	return new Response(body, { status: 200, headers: h });
}
