import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { requireLabAdmin } from '$lib/server/guards';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { labId } = requireLabAdmin(locals);
	const db = getDb();

	const run = db.prepare(
		`SELECT r.*, p.slug AS pipeline_slug, p.name AS pipeline_name
		 FROM runs r
		 JOIN pipelines p ON p.id = r.pipeline_id
		 WHERE r.id = ? AND r.lab_id = ?`
	).get(params.id, labId) as Record<string, unknown> | undefined;
	if (!run) throw error(404, 'Run not found');

	const grants = db.prepare(
		`SELECT ra.user_id, ra.role, ra.added_at,
		        u.username, u.display_name, u.email, u.avatar_url, u.avatar_emoji
		 FROM run_access ra
		 JOIN users u ON u.id = ra.user_id
		 WHERE ra.run_id = ?
		 ORDER BY u.username`
	).all(params.id);

	// Users from the same lab — admin-visible pool to grant from. Cross-lab
	// grants go via the invite flow + run_access on the recipient's id; for
	// day-one UI simplicity this page only offers same-lab users.
	const grantableUsers = db.prepare(
		`SELECT u.id, u.username, u.display_name, u.email
		 FROM lab_memberships m
		 JOIN users u ON u.id = m.user_id
		 WHERE m.lab_id = ? AND m.status = 'active'
		 ORDER BY u.username`
	).all(labId);

	return { run, grants, grantableUsers };
};
