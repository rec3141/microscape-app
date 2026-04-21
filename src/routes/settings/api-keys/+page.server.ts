import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { requireLabAdmin } from '$lib/server/guards';

export const load: PageServerLoad = async ({ locals }) => {
	const { labId } = requireLabAdmin(locals);
	const db = getDb();
	const keys = db.prepare(
		`SELECT k.id, k.name, k.key_prefix, k.created_at, k.last_used_at, k.revoked_at,
		        u.username AS created_by_username
		 FROM api_keys k
		 LEFT JOIN users u ON u.id = k.created_by
		 WHERE k.lab_id = ?
		 ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC`
	).all(labId);
	return { keys };
};
