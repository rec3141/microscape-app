import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { requireLabAdmin } from '$lib/server/guards';

export const load: PageServerLoad = async ({ locals, url }) => {
	const { labId } = requireLabAdmin(locals);
	const db = getDb();

	const invites = db.prepare(`
		SELECT i.token, i.role, i.email_hint, i.created_at, i.expires_at, i.used_at,
		       cu.username AS created_by_username,
		       uu.username AS used_by_username
		FROM invites i
		LEFT JOIN users cu ON cu.id = i.created_by
		LEFT JOIN users uu ON uu.id = i.used_by
		WHERE i.lab_id = ?
		ORDER BY i.created_at DESC
		LIMIT 100
	`).all(labId);

	return {
		invites,
		// Origin of the live app — used to build copy-to-clipboard invite URLs
		// rather than relying on window.location (works during SSR too).
		origin: url.origin
	};
};
