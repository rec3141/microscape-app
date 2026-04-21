import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { requireUser } from '$lib/server/guards';

/**
 * Single run viewer. Visibility mirrors the landing-page rule:
 *   run.is_public OR active lab member OR explicit run_access row.
 * On a miss we return 404 (not 403) to avoid confirming the run exists.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const user = requireUser(locals);
	const db = getDb();

	const row = db.prepare(
		`SELECT
			r.id, r.slug, r.name, r.description, r.is_public, r.data_path,
			r.created_at, r.updated_at,
			p.slug AS pipeline_slug, p.name AS pipeline_name,
			l.name AS lab_name, l.slug AS lab_slug,
			CASE
				WHEN r.is_public = 1 THEN 'public'
				WHEN m.user_id IS NOT NULL THEN 'lab'
				WHEN ra.user_id IS NOT NULL THEN 'invited'
				ELSE NULL
			END AS access_via,
			COALESCE(ra.role, m.role, 'viewer') AS effective_role
		FROM runs r
		JOIN pipelines p ON p.id = r.pipeline_id
		JOIN labs l ON l.id = r.lab_id
		LEFT JOIN lab_memberships m
		  ON m.lab_id = r.lab_id AND m.user_id = ? AND m.status = 'active'
		LEFT JOIN run_access ra
		  ON ra.run_id = r.id AND ra.user_id = ?
		WHERE r.id = ?
		  AND (r.is_public = 1 OR m.user_id IS NOT NULL OR ra.user_id IS NOT NULL)`
	).get(user.id, user.id, params.id);

	if (!row) throw error(404, 'Run not found or access denied');
	return { run: row };
};
