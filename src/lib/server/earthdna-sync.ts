/**
 * Rooms for EarthDNA screens that move together (a multi-screen wall: globe.js ?sync=ROOM, served by
 * src/routes/earthdna/sync/[room]/[kind]/+server.ts). Held in memory: a room is its listening screens, the
 * leader's latest state (sent to each screen as it joins) and a log rate limit. A room exists while anyone
 * uses it and goes after an hour unused.
 *
 * Anyone who knows a room's name can join it or steer it, so names are long (ROOM_RE) and only ever shared
 * with the screens; nothing in a room is private beyond what the page itself shows.
 */

export const ROOM_RE = /^[A-Za-z0-9_-]{12,64}$/;
export const MAX_BODY = 32 * 1024;
const MAX_ROOMS = 200;
const IDLE_MS = 60 * 60 * 1000;
const LOGS_PER_MINUTE = 20;

type Listener = (chunk: string) => void;
interface Room {
	listeners: Set<Listener>;
	last: string | null;
	used: number;
	logTimes: number[];
}

const rooms = new Map<string, Room>();

export function getRoom(name: string): Room | null {
	let r = rooms.get(name);
	if (!r) {
		if (rooms.size >= MAX_ROOMS) sweep();
		if (rooms.size >= MAX_ROOMS) return null;
		r = { listeners: new Set(), last: null, used: Date.now(), logTimes: [] };
		rooms.set(name, r);
	}
	r.used = Date.now();
	return r;
}

/** one server-sent event to every screen in the room */
export function publish(r: Room, event: string | null, data: string) {
	const chunk = (event ? `event: ${event}\n` : '') + `data: ${data}\n\n`;
	for (const send of r.listeners) send(chunk);
}

/** whether the room may write another screen error to the server log */
export function mayLog(r: Room): boolean {
	const now = Date.now();
	r.logTimes = r.logTimes.filter((t) => now - t < 60_000);
	if (r.logTimes.length >= LOGS_PER_MINUTE) return false;
	r.logTimes.push(now);
	return true;
}

function sweep() {
	const now = Date.now();
	for (const [name, r] of rooms) if (!r.listeners.size && now - r.used > IDLE_MS) rooms.delete(name);
}
setInterval(sweep, 10 * 60 * 1000).unref?.();
