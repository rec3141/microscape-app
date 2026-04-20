import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { requireLabAdmin } from '$lib/server/guards';
import { apiError } from '$lib/server/api-errors';

/**
 * Delete the caller's lab. WIPES every project, sample, site, extract,
 * PCR plate / amp, library plate / prep, sequencing run + run-libraries
 * link, analysis, personnel, picklist, primer set, pcr protocol, saved
 * cart, invite, db_snapshot, and feedback row owned by this lab.
 *
 * Existing users in the lab are NOT deleted. Their lab_id is set to
 * NULL and role reverts to 'user' — they hit the lab-setup gate on
 * their next page load and can either start a new lab or accept an
 * invite. Their sessions are wiped so a stale tab can't keep operating
 * on a half-gone lab.
 *
 * Confirmation: body must include `confirm: "<lab name>"` (case-sensitive,
 * the literal name, not slug). GitHub-style "type the name to confirm"
 * pattern. The whole operation runs in a transaction so a partial wipe
 * can't happen.
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
			.prepare('SELECT id, name, slug FROM labs WHERE id = ?')
			.get(labId) as { id: string; name: string; slug: string } | undefined;
		if (!lab) return json({ error: 'Lab not found' }, { status: 404 });

		if (typeof body.confirm !== 'string' || body.confirm !== lab.name) {
			return json(
				{ error: `Type the lab name (${lab.name}) into the confirmation field to delete this lab.` },
				{ status: 400 }
			);
		}

		// foreign_keys was turned ON in getDb(), so the DELETE FROM labs
		// below cascades through every CASCADE-configured FK (projects →
		// sites/samples/extracts/etc., personnel, picklists, primer sets,
		// pcr protocols, saved_carts, db_snapshots, invites, feedback).
		// users.lab_id is the only no-cascade FK touching labs — null it
		// out first so the DELETE doesn't fail with a constraint error.
		//
		// defer_foreign_keys: a few intra-lab FKs use RESTRICT / NO ACTION
		// rather than CASCADE — samples.site_id (RESTRICT), library_plates.
		// pcr_plate_id (NO ACTION), and the primer_set_id refs on pcr_plates
		// + pcr_amplifications. RESTRICT in particular fires immediately,
		// not at end-of-statement, so during the cascade the engine can
		// briefly see a samples row pointing at a sites row that's about
		// to be deleted (or a library_plate pointing at a doomed pcr_plate)
		// and reject. defer_foreign_keys = ON pushes ALL FK checks to
		// commit time, by which point the whole sub-graph is gone and
		// every constraint is satisfied. The pragma is automatically reset
		// at the end of the transaction (it's per-tx, not session-wide).
		db.transaction(() => {
			db.pragma('defer_foreign_keys = ON');
			// Drop sessions for everyone in this lab so half-loaded tabs
			// don't keep operating against deleted data — EXCEPT the
			// deleting admin's own session, so they get gracefully
			// redirected to /auth/setup-lab on their next request rather
			// than booted out to /auth/login mid-flow.
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
			// Clear both active_lab_id and legacy lab_id for any user
			// pointing at this lab. The legacy lab_id FK has no CASCADE,
			// so it must be nulled before the labs row is deleted.
			db.prepare(
				"UPDATE users SET active_lab_id = NULL, lab_id = NULL, role = 'user', updated_at = datetime('now') WHERE active_lab_id = ? OR lab_id = ?"
			).run(labId, labId);
			// lab_memberships rows cascade-delete from labs FK
			db.prepare('DELETE FROM labs WHERE id = ?').run(labId);
			// Fall back: if a user still has memberships in other labs,
			// point active_lab_id at their first remaining one so they
			// don't get stranded at /auth/setup-lab.
			db.prepare(
				`UPDATE users SET active_lab_id = (
				   SELECT m.lab_id FROM lab_memberships m
				   WHERE m.user_id = users.id AND m.status = 'active'
				   LIMIT 1
				 ) WHERE active_lab_id IS NULL
				   AND EXISTS (SELECT 1 FROM lab_memberships m2
				               WHERE m2.user_id = users.id AND m2.status = 'active')`
			).run();
		})();

		return json({ ok: true, name: lab.name });
	} catch (err) {
		return apiError(err);
	}
};
