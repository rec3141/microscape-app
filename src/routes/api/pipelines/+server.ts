import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { requireUser } from '$lib/server/guards';

/**
 * Pipelines are a global, read-only list for the client (seeded from
 * `seedPipelines` in db.ts). Any authenticated user can list them — the set
 * is not sensitive, and the Run form needs to pick from it. Write
 * endpoints are intentionally absent: to add a pipeline, edit db.ts and
 * restart the server.
 */
export const GET: RequestHandler = async ({ locals }) => {
	requireUser(locals);
	const db = getDb();
	const rows = db
		.prepare('SELECT id, slug, name, description FROM pipelines ORDER BY name')
		.all();
	return json(rows);
};
