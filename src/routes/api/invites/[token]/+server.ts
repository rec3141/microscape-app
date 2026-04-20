import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { requireLabAdmin } from '$lib/server/guards';
import { apiError } from '$lib/server/api-errors';

/** Revoke (delete) an unused invite. Used invites stay in the DB for
 *  attribution; deleting one that's already been accepted would also be
 *  a no-op for access control (the user already joined). */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { labId } = requireLabAdmin(locals);
	try {
		const db = getDb();
		const row = db
			.prepare('SELECT lab_id, used_at FROM invites WHERE token = ?')
			.get(params.token) as { lab_id: string; used_at: string | null } | undefined;
		if (!row || row.lab_id !== labId) throw error(404, 'Invite not found');
		if (row.used_at) {
			return json({ error: 'Cannot revoke an invite that has already been accepted' }, { status: 409 });
		}
		db.prepare('DELETE FROM invites WHERE token = ?').run(params.token);
		return json({ ok: true });
	} catch (err) {
		return apiError(err);
	}
};
