import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * Single run viewer. Visibility:
 *   - Anonymous:     run.lab.slug = 'public' (the dedicated public lab)
 *   - Authenticated: run.is_shared (cross-lab) OR lab member OR run_access
 * On a miss we return 404 (not 403) to avoid confirming the run exists.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const user = locals.user;
	const db = getDb();
	const uid = user?.id ?? '';

	const row = db.prepare(
		`SELECT
			r.id, r.slug, r.name, r.description, r.is_shared, r.data_path,
			r.created_at, r.updated_at,
			p.slug AS pipeline_slug, p.name AS pipeline_name,
			l.name AS lab_name, l.slug AS lab_slug,
			CASE
				WHEN l.slug = 'public' THEN 'public'
				WHEN m.user_id IS NOT NULL THEN 'lab'
				WHEN ra.user_id IS NOT NULL THEN 'invited'
				WHEN r.is_shared = 1 THEN 'shared'
				ELSE NULL
			END AS access_via,
			COALESCE(ra.role, m.role, 'viewer') AS effective_role,
			-- Edit affordance: only lab-admins of the run's owning lab can
			-- reach /settings/runs/<id>. Cross-lab viewers and run_access
			-- invitees see the dashboard but not the admin pencil.
			CASE WHEN m.role = 'admin' THEN 1 ELSE 0 END AS can_edit
		FROM runs r
		JOIN pipelines p ON p.id = r.pipeline_id
		JOIN labs l ON l.id = r.lab_id
		LEFT JOIN lab_memberships m
		  ON m.lab_id = r.lab_id AND m.user_id = ? AND m.status = 'active'
		LEFT JOIN run_access ra
		  ON ra.run_id = r.id AND ra.user_id = ?
		WHERE r.id = ?
		  AND (
		    l.slug = 'public'
		    OR (? != '' AND (r.is_shared = 1 OR m.user_id IS NOT NULL OR ra.user_id IS NOT NULL))
		  )`
	).get(uid, uid, params.id, uid);

	if (!row) throw error(404, 'Run not found or access denied');
	return { run: row };
};
