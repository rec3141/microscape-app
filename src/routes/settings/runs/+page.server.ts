import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { requireLabAdmin } from '$lib/server/guards';

export const load: PageServerLoad = async ({ locals }) => {
	const { labId } = requireLabAdmin(locals);
	const db = getDb();

	const runs = db.prepare(
		`SELECT r.id, r.slug, r.name, r.description, r.data_path, r.is_public, r.created_at,
		        p.slug AS pipeline_slug, p.name AS pipeline_name,
		        (SELECT COUNT(*) FROM run_access WHERE run_id = r.id) AS grant_count
		 FROM runs r
		 JOIN pipelines p ON p.id = r.pipeline_id
		 WHERE r.lab_id = ?
		 ORDER BY r.created_at DESC`
	).all(labId);

	const pipelines = db
		.prepare('SELECT id, slug, name FROM pipelines ORDER BY name')
		.all();

	return { runs, pipelines };
};
