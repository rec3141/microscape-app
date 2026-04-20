import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { requireUser } from '$lib/server/guards';
import { apiError } from '$lib/server/api-errors';
import { checkRate } from '$lib/server/rate-limit';
import { createLab } from '$lib/server/lab-setup';

const MAX_LAB_NAME = 80;

/**
 * Self-serve lab creation. Caller must be authenticated. On success: lab
 * is created with picklists seeded, the caller becomes its admin, and
 * their active_lab_id is switched to the new lab. Works for both first-
 * time signups (no lab yet) and existing users creating an additional lab.
 *
 * Rate-limited per IP at 3 lab creations per day.
 */
export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	const user = requireUser(locals);
	if (user.is_demo) {
		return json({ error: 'Demo accounts cannot create labs' }, { status: 403 });
	}

	const ip = getClientAddress();
	if (!checkRate(`lab-create:${ip}`, 3, 24 * 60 * 60_000)) {
		return json({ error: 'Too many lab creations from this address; try again tomorrow' }, { status: 429 });
	}

	let body: { name?: unknown; slug?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
	if (!name) return json({ error: 'Lab name is required' }, { status: 400 });
	if (name.length > MAX_LAB_NAME) {
		return json({ error: `Lab name must be ${MAX_LAB_NAME} characters or fewer` }, { status: 400 });
	}

	try {
		const db = getDb();
		const labId = createLab(db, name, slug);
		// First user in a new lab becomes its admin via lab_memberships.
		db.prepare(
			`INSERT INTO lab_memberships (user_id, lab_id, role, status)
			 VALUES (?, ?, 'admin', 'active')`
		).run(user.id, labId);
		db.prepare(
			"UPDATE users SET lab_id = ?, active_lab_id = ?, role = 'admin', updated_at = datetime('now') WHERE id = ?"
		).run(labId, labId, user.id);
		const lab = db.prepare('SELECT id, name, slug FROM labs WHERE id = ?').get(labId);
		return json({ lab }, { status: 201 });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('already taken')) {
			return json({ error: msg }, { status: 409 });
		}
		return apiError(err);
	}
};
