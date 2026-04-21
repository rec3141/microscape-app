import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { requireLabAdmin } from '$lib/server/guards';
import { assertLabOwnsRow } from '$lib/server/lab-scope';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { labId } = requireLabAdmin(locals);
	const db = getDb();
	assertLabOwnsRow(db, 'runs', params.id!, labId);
	db.prepare('DELETE FROM run_access WHERE run_id = ? AND user_id = ?').run(params.id, params.userId);
	return json({ ok: true });
};
