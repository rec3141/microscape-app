/**
 * In-memory sliding-window rate limiter.
 *
 * Good enough for a single-process pm2 deployment. If we ever scale to
 * multiple workers we should swap this for a SQLite-backed counter or
 * front it with nginx limit_req.
 *
 * Usage:
 *   if (!checkRate(`login:${ip}`, 5, 60_000)) throw new Error('rate limited');
 */

const buckets = new Map<string, number[]>();
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 5 * 60_000;

/**
 * Returns true if the request is allowed, false if it's over the limit.
 * `limit` requests per `windowMs` milliseconds, per `key`.
 */
export function checkRate(key: string, limit: number, windowMs: number): boolean {
	const now = Date.now();

	// Periodic sweep so abandoned keys don't grow the map forever.
	if (now - lastSweep > SWEEP_INTERVAL_MS) {
		const cutoff = now - windowMs;
		for (const [k, hits] of buckets) {
			const fresh = hits.filter((t) => t > cutoff);
			if (fresh.length === 0) buckets.delete(k);
			else buckets.set(k, fresh);
		}
		lastSweep = now;
	}

	const cutoff = now - windowMs;
	const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);

	if (hits.length >= limit) {
		buckets.set(key, hits);
		return false;
	}

	hits.push(now);
	buckets.set(key, hits);
	return true;
}
