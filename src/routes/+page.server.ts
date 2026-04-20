import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';

/**
 * Landing page: runs the signed-in user has access to.
 *
 * A user sees a run when *any* of these hold:
 *   1. run.is_public = 1 (no ACL check at all)
 *   2. user is an active member of run.lab_id (implicit lab grant)
 *   3. user has a run_access row for the run (explicit cross-lab grant)
 *
 * `access_via` surfaces which of those three granted access so the UI can
 * render a chip ("public" / "lab" / "invited") explaining the row.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { runs: [] };
	const db = getDb();

	const runs = db.prepare(`
		SELECT
			r.id, r.slug, r.name, r.description, r.is_public, r.created_at,
			p.slug AS pipeline_slug, p.name AS pipeline_name,
			l.name AS lab_name, l.slug AS lab_slug,
			CASE
				WHEN r.is_public = 1 THEN 'public'
				WHEN m.user_id IS NOT NULL THEN 'lab'
				WHEN ra.user_id IS NOT NULL THEN 'invited'
				ELSE NULL
			END AS access_via
		FROM runs r
		JOIN pipelines p ON p.id = r.pipeline_id
		JOIN labs l ON l.id = r.lab_id
		LEFT JOIN lab_memberships m
		  ON m.lab_id = r.lab_id AND m.user_id = ? AND m.status = 'active'
		LEFT JOIN run_access ra
		  ON ra.run_id = r.id AND ra.user_id = ?
		WHERE r.is_public = 1 OR m.user_id IS NOT NULL OR ra.user_id IS NOT NULL
		ORDER BY r.created_at DESC
	`).all(locals.user.id, locals.user.id);

	return { runs };
};
