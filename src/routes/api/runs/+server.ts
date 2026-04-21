import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb, generateId } from '$lib/server/db';
import { apiError } from '$lib/server/api-errors';
import { requireLab, requireLabAdmin } from '$lib/server/guards';
import { parseBody } from '$lib/server/validation';
import { RunCreateBody } from '$lib/server/schemas/runs';

const RUN_COLS = `
	r.id, r.lab_id, r.pipeline_id, r.slug, r.name, r.description,
	r.data_path, r.is_public, r.created_by, r.created_at, r.updated_at,
	p.slug AS pipeline_slug, p.name AS pipeline_name
`;

/**
 * GET /api/runs — list runs in the caller's active lab. Any lab member
 * may list; cross-lab run_access grants are NOT merged in here (that's
 * the landing-page query in +page.server.ts). Admin pages use this to
 * populate the runs-admin table.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const { labId } = requireLab(locals);
	const db = getDb();
	const runs = db.prepare(
		`SELECT ${RUN_COLS}
		 FROM runs r
		 JOIN pipelines p ON p.id = r.pipeline_id
		 WHERE r.lab_id = ?
		 ORDER BY r.created_at DESC`
	).all(labId);
	return json(runs);
};

/**
 * POST /api/runs — register a new run in the caller's lab. Lab-admin only
 * (gated both here and in hooks.server.ts). The caller supplies the
 * filesystem path; this endpoint does NOT validate that the path exists
 * or that the app has read permission — deploy-time concerns, checked at
 * file-serve time.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { user, labId } = requireLabAdmin(locals);
	const parsed = parseBody(RunCreateBody, await request.json().catch(() => null));
	if (!parsed.ok) return parsed.response;
	const data = parsed.data;

	try {
		const id = generateId();
		const db = getDb();

		const pipeline = db
			.prepare('SELECT id FROM pipelines WHERE id = ?')
			.get(data.pipeline_id);
		if (!pipeline) return json({ error: 'Unknown pipeline' }, { status: 400 });

		db.prepare(
			`INSERT INTO runs (id, lab_id, pipeline_id, slug, name, description, data_path, is_public, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run(
			id,
			labId,
			data.pipeline_id,
			data.slug,
			data.name,
			data.description ?? null,
			data.data_path,
			data.is_public,
			user.id
		);

		const run = db.prepare(
			`SELECT ${RUN_COLS} FROM runs r JOIN pipelines p ON p.id = r.pipeline_id WHERE r.id = ?`
		).get(id);
		return json(run, { status: 201 });
	} catch (err) {
		return apiError(err);
	}
};
