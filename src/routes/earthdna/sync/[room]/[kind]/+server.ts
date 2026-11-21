import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { ROOM_RE, MAX_BODY, getRoom, publish, mayLog } from '$lib/server/earthdna-sync';

/**
 * The relay for EarthDNA screens that move together (globe.js ?sync=ROOM; rooms in $lib/server/earthdna-sync).
 *
 *   GET  /earthdna/sync/ROOM/events  server-sent events: the leading screen's state (default event, the latest one
 *                                    first) and the 3D mouse's axes (event "nav")
 *   POST /earthdna/sync/ROOM/state   the leading screen's state (JSON), passed to every screen in the room
 *   POST /earthdna/sync/ROOM/nav     a 3D mouse's axes, { a: [x, y, z, rx, ry, rz] } (earthdna viewer/lg_server.py --relay)
 *   POST /earthdna/sync/ROOM/log     a screen's error, written to the server log
 *
 * Public like the globes themselves: the room name is the only key.
 */

function roomOf(name: string) {
	if (!ROOM_RE.test(name)) error(404, 'No such room');
	const r = getRoom(name);
	if (!r) error(503, 'Too many rooms');
	return r;
}

export const GET: RequestHandler = ({ params, request }) => {
	if (params.kind !== 'events') error(404, 'Not found');
	const r = roomOf(params.room);
	const enc = new TextEncoder();
	let send: ((chunk: string) => void) | null = null;
	let ping: ReturnType<typeof setInterval> | null = null;
	const stop = () => {
		if (send) r.listeners.delete(send);
		if (ping) clearInterval(ping);
		send = null; ping = null;
	};
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			send = (chunk) => {
				try { controller.enqueue(enc.encode(chunk)); } catch { stop(); }
			};
			if (r.last) send(`data: ${r.last}\n\n`);
			r.listeners.add(send);
			// keeps proxies from closing an idle stream
			ping = setInterval(() => send?.(': ping\n\n'), 15_000);
			request.signal.addEventListener('abort', () => { stop(); try { controller.close(); } catch { /* already closed */ } });
		},
		cancel: stop
	});
	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-store',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no' // nginx: pass events through as they come
		}
	});
};

export const POST: RequestHandler = async ({ params, request }) => {
	const r = roomOf(params.room);
	const body = await request.text();
	if (body.length > MAX_BODY) error(413, 'Too large');
	let data: unknown;
	try { data = JSON.parse(body); } catch { error(400, 'Not JSON'); }
	if (typeof data !== 'object' || data === null) error(400, 'Not an object');
	if (params.kind === 'state') {
		r.last = body;
		publish(r, null, body);
	} else if (params.kind === 'nav') {
		const a = (data as { a?: unknown }).a;
		if (!Array.isArray(a) || a.length !== 6 || !a.every((v) => typeof v === 'number' && Number.isFinite(v))) error(400, 'Bad axes');
		publish(r, 'nav', JSON.stringify({ a: a.map((v) => Math.max(-1, Math.min(1, v))) }));
	} else if (params.kind === 'log') {
		if (mayLog(r)) console.error(`[earthdna wall ${params.room.slice(0, 6)}…]`, body.slice(0, 2000));
	} else error(404, 'Not found');
	return new Response(null, { status: 204 });
};
