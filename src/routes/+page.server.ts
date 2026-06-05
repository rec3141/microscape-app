import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';

/**
 * Landing page. Two audiences, two queries:
 *   - Anonymous: only runs with visibility='public'.
 *   - Authenticated: runs in their active lab, plus explicit run_access
 *     grants, plus visibility in ('shared', 'public'). Switching the
 *     active lab in the navbar is how they change which "lab" rows they
 *     see. Visibility is a property of the run, not its owning lab — a
 *     public run stays in its owning lab.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const db = getDb();

	if (!locals.user) {
		const runs = db.prepare(`
			SELECT
				r.id, r.slug, r.name, r.description, r.visibility, r.created_at,
				p.slug AS pipeline_slug, p.name AS pipeline_name,
				l.name AS lab_name, l.slug AS lab_slug,
				'public' AS access_via
			FROM runs r
			JOIN pipelines p ON p.id = r.pipeline_id
			JOIN labs l ON l.id = r.lab_id
			WHERE r.visibility = 'public'
			ORDER BY r.created_at DESC
		`).all();
		return { runs };
	}

	if (!locals.user.lab_id) return { runs: [] };

	const runs = db.prepare(`
		SELECT
			r.id, r.slug, r.name, r.description, r.visibility, r.created_at,
			p.slug AS pipeline_slug, p.name AS pipeline_name,
			l.name AS lab_name, l.slug AS lab_slug,
			CASE
				WHEN r.lab_id = ? THEN 'lab'
				WHEN ra.user_id IS NOT NULL THEN 'invited'
				WHEN r.visibility = 'public' THEN 'public'
				WHEN r.visibility = 'shared' THEN 'shared'
				ELSE NULL
			END AS access_via
		FROM runs r
		JOIN pipelines p ON p.id = r.pipeline_id
		JOIN labs l ON l.id = r.lab_id
		LEFT JOIN run_access ra
		  ON ra.run_id = r.id AND ra.user_id = ?
		WHERE r.lab_id = ?
		   OR ra.user_id IS NOT NULL
		   OR r.visibility IN ('shared', 'public')
		ORDER BY
		  CASE WHEN r.lab_id = ? THEN 0 ELSE 1 END,
		  r.created_at DESC
	`).all(locals.user.lab_id, locals.user.id, locals.user.lab_id, locals.user.lab_id);

	return { runs };
};
