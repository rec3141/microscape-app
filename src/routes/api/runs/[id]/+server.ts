import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError } from '$lib/server/api-errors';
import { requireLab, requireLabAdmin } from '$lib/server/guards';
import { assertLabOwnsRow } from '$lib/server/lab-scope';
import { parseBody } from '$lib/server/validation';
import { RunUpdateBody } from '$lib/server/schemas/runs';

const RUN_COLS = `
	r.id, r.lab_id, r.pipeline_id, r.slug, r.name, r.description,
	r.data_path, r.is_public, r.created_by, r.created_at, r.updated_at,
	p.slug AS pipeline_slug, p.name AS pipeline_name
`;

export const GET: RequestHandler = async ({ params, locals }) => {
	const { labId } = requireLab(locals);
	const db = getDb();
	assertLabOwnsRow(db, 'runs', params.id!, labId);
	const run = db
		.prepare(
			`SELECT ${RUN_COLS} FROM runs r JOIN pipelines p ON p.id = r.pipeline_id WHERE r.id = ?`
		)
		.get(params.id);
	return json(run);
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const { labId } = requireLabAdmin(locals);
	const parsed = parseBody(RunUpdateBody, await request.json().catch(() => null));
	if (!parsed.ok) return parsed.response;
	const data = parsed.data;

	const db = getDb();
	assertLabOwnsRow(db, 'runs', params.id!, labId);

	// Build a dynamic UPDATE from only the supplied fields — the zod schema
	// already enforced the shape so the keys are safe to interpolate.
	const set: string[] = [];
	const vals: unknown[] = [];
	for (const [k, v] of Object.entries(data)) {
		if (v === undefined) continue;
		set.push(`${k} = ?`);
		vals.push(v);
	}
	if (set.length === 0) return json({ ok: true }); // nothing to update
	set.push(`updated_at = datetime('now')`);

	try {
		db.prepare(`UPDATE runs SET ${set.join(', ')} WHERE id = ?`).run(...vals, params.id);
		const run = db
			.prepare(
				`SELECT ${RUN_COLS} FROM runs r JOIN pipelines p ON p.id = r.pipeline_id WHERE r.id = ?`
			)
			.get(params.id);
		return json(run);
	} catch (err) {
		return apiError(err);
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { labId } = requireLabAdmin(locals);
	const db = getDb();
	assertLabOwnsRow(db, 'runs', params.id!, labId);
	db.prepare('DELETE FROM runs WHERE id = ?').run(params.id);
	return json({ ok: true });
};
