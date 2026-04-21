import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';

/**
 * Landing page: runs in the caller's active lab, plus runs that have been
 * explicitly shared with them via a `run_access` grant.
 *
 * We intentionally do NOT surface runs from OTHER labs the user is a
 * member of — switching the active lab in the navbar is how they change
 * what they see. Cross-lab public runs are reachable by URL (e.g. the
 * slug alias route) but don't appear on every user's landing.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.user.lab_id) return { runs: [] };
	const db = getDb();

	const runs = db.prepare(`
		SELECT
			r.id, r.slug, r.name, r.description, r.is_public, r.created_at,
			p.slug AS pipeline_slug, p.name AS pipeline_name,
			l.name AS lab_name, l.slug AS lab_slug,
			CASE
				WHEN r.lab_id = ? THEN 'lab'
				WHEN ra.user_id IS NOT NULL THEN 'invited'
				ELSE NULL
			END AS access_via
		FROM runs r
		JOIN pipelines p ON p.id = r.pipeline_id
		JOIN labs l ON l.id = r.lab_id
		LEFT JOIN run_access ra
		  ON ra.run_id = r.id AND ra.user_id = ?
		WHERE r.lab_id = ?
		   OR ra.user_id IS NOT NULL
		ORDER BY
		  CASE WHEN r.lab_id = ? THEN 0 ELSE 1 END,
		  r.created_at DESC
	`).all(locals.user.lab_id, locals.user.id, locals.user.lab_id, locals.user.lab_id);

	return { runs };
};
