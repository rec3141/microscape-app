import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError } from '$lib/server/api-errors';
import { requireLabAdmin } from '$lib/server/guards';
import { assertLabOwnsRow } from '$lib/server/lab-scope';
import { parseBody } from '$lib/server/validation';
import { RunAccessGrantBody } from '$lib/server/schemas/runs';

/**
 * GET /api/runs/[id]/access — list every user with explicit run_access on
 * this run. Joins `users` for display fields. Does NOT include implicit
 * lab-member access — those aren't per-user rows, they're per-membership.
 * The admin UI shows implicit grants as a separate section.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const { labId } = requireLabAdmin(locals);
	const db = getDb();
	assertLabOwnsRow(db, 'runs', params.id!, labId);

	const grants = db.prepare(
		`SELECT ra.user_id, ra.role, ra.added_at, ra.added_by,
		        u.username, u.display_name, u.email, u.avatar_url, u.avatar_emoji
		 FROM run_access ra
		 JOIN users u ON u.id = ra.user_id
		 WHERE ra.run_id = ?
		 ORDER BY u.username`
	).all(params.id);
	return json(grants);
};

/**
 * POST /api/runs/[id]/access — grant a single user access to the run.
 * `user_id` may belong to any lab; this is how cross-lab collaborators get
 * a narrow view of a run without also joining the owning lab. ON CONFLICT
 * bumps the role so re-submitting is a harmless change-of-role.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { user, labId } = requireLabAdmin(locals);
	const parsed = parseBody(RunAccessGrantBody, await request.json().catch(() => null));
	if (!parsed.ok) return parsed.response;
	const { user_id, role } = parsed.data;

	const db = getDb();
	assertLabOwnsRow(db, 'runs', params.id!, labId);

	try {
		// Make sure the target user exists — otherwise we'd silently create
		// an orphan row referencing a nonexistent user.
		const target = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
		if (!target) return json({ error: 'Unknown user' }, { status: 400 });

		db.prepare(
			`INSERT INTO run_access (run_id, user_id, role, added_by)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(run_id, user_id) DO UPDATE SET
			   role = excluded.role,
			   added_at = datetime('now'),
			   added_by = excluded.added_by`
		).run(params.id, user_id, role, user.id);

		return json({ ok: true }, { status: 201 });
	} catch (err) {
		return apiError(err);
	}
};
