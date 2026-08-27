import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { requireLabAdmin } from '$lib/server/guards';
import { apiError } from '$lib/server/api-errors';

/**
 * SOFT-delete the caller's lab: stamps labs.deleted_at, after which the
 * lab and everything in it (runs, file serving, API keys, memberships)
 * is invisible everywhere. Rows and run data stay intact for 30 days —
 * the purge sweep in db.ts then hard-deletes the lab and removes its
 * runs' data directories from RUNS_ROOT. Until the purge fires, an
 * operator can restore the lab by nulling deleted_at.
 *
 * Existing users in the lab are NOT deleted. Their active lab is
 * re-pointed at another (live) membership, or they hit the lab-setup
 * gate on their next page load. Their sessions are wiped so a stale tab
 * can't keep operating on a half-gone lab.
 *
 * Confirmation: body must include `confirm: "<lab name>"` (case-sensitive,
 * the literal name, not slug). GitHub-style "type the name to confirm"
 * pattern. The whole operation runs in a transaction.
 */
export const DELETE: RequestHandler = async ({ request, locals, cookies }) => {
	const { user, labId } = requireLabAdmin(locals);
	const callerSessionId = cookies.get('session');

	let body: { confirm?: unknown };
	try {
		body = await request.json();
	} catch {
		body = {};
	}

	try {
		const db = getDb();
		const lab = db
			.prepare('SELECT id, name, slug, deleted_at FROM labs WHERE id = ?')
			.get(labId) as { id: string; name: string; slug: string; deleted_at: string | null } | undefined;
		if (!lab) return json({ error: 'Lab not found' }, { status: 404 });

		if (typeof body.confirm !== 'string' || body.confirm !== lab.name) {
			return json(
				{ error: `Type the lab name (${lab.name}) into the confirmation field to delete this lab.` },
				{ status: 400 }
			);
		}

		if (lab.deleted_at) return json({ error: 'Lab is already deleted' }, { status: 400 });

		db.transaction(() => {
			// Soft delete: the single stamp that hides the lab everywhere.
			// Rows and run data survive until the 30-day purge sweep.
			db.prepare(
				"UPDATE labs SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
			).run(labId);
			// Drop sessions for everyone in this lab so half-loaded tabs
			// don't keep operating against deleted data — EXCEPT the
			// deleting admin's own session, so they get gracefully
			// redirected on their next request rather than booted out to
			// /auth/login mid-flow.
			if (callerSessionId) {
				db.prepare(
					`DELETE FROM sessions
					 WHERE user_id IN (SELECT user_id FROM lab_memberships WHERE lab_id = ?)
					   AND id != ?`
				).run(labId, callerSessionId);
			} else {
				db.prepare(
					'DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM lab_memberships WHERE lab_id = ?)'
				).run(labId);
			}
			// Re-point anyone whose active lab this was at their first
			// remaining LIVE membership (or NULL → lab-setup gate).
			db.prepare(
				`UPDATE users SET active_lab_id = (
				   SELECT m.lab_id FROM lab_memberships m
				   JOIN labs l ON l.id = m.lab_id AND l.deleted_at IS NULL
				   WHERE m.user_id = users.id AND m.status = 'active'
				   LIMIT 1
				 ), updated_at = datetime('now')
				 WHERE active_lab_id = ?`
			).run(labId);
			db.prepare('UPDATE users SET lab_id = NULL WHERE lab_id = ?').run(labId);
		})();

		return json({ ok: true, name: lab.name, purge_after_days: 30 });
	} catch (err) {
		return apiError(err);
	}
};
