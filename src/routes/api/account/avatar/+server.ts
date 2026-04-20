import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { requireUser } from '$lib/server/guards';
import { apiError } from '$lib/server/api-errors';

/**
 * Set (or clear) the current user's avatar emoji.
 *
 * Accepts any short string — the client picks what to store. Cap at 8
 * characters so a ZWJ-joined emoji (e.g. 👨🏻‍🔬) fits but nothing longer
 * ends up in the navbar header slot. Empty / missing / whitespace-only
 * values clear the avatar (stored as NULL).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireUser(locals);
	try {
		const body = (await request.json().catch(() => null)) as { emoji?: unknown } | null;
		const raw = typeof body?.emoji === 'string' ? body.emoji.trim() : '';
		const emoji = raw.length === 0 ? null : raw.slice(0, 8);
		const db = getDb();
		db.prepare("UPDATE users SET avatar_emoji = ?, updated_at = datetime('now') WHERE id = ?")
			.run(emoji, user.id);
		return json({ ok: true, avatar_emoji: emoji });
	} catch (err) {
		return apiError(err);
	}
};
