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
	r.data_path, r.visibility, r.created_by, r.created_at, r.updated_at,
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
	const fields = parsed.data;

	const db = getDb();
	assertLabOwnsRow(db, 'runs', params.id!, labId);

	try {
		// Build a dynamic UPDATE from any supplied fields. zod already
		// enforced shape so the keys are safe to interpolate. Visibility
		// is one of these fields — there's no separate "move lab" path
		// any more, the run stays in its owning lab regardless.
		const set: string[] = [];
		const vals: unknown[] = [];
		for (const [k, v] of Object.entries(fields)) {
			if (v === undefined) continue;
			set.push(`${k} = ?`);
			vals.push(v);
		}
		if (set.length > 0) {
			set.push(`updated_at = datetime('now')`);
			db.prepare(`UPDATE runs SET ${set.join(', ')} WHERE id = ?`).run(...vals, params.id);
		}

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
