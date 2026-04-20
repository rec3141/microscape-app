import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';

interface InviteRow {
	token: string;
	role: string;
	email_hint: string | null;
	expires_at: string;
	used_at: string | null;
	lab_name: string;
}

/**
 * Public page that shows what the invite is for. Doesn't accept the invite
 * itself — that requires an authenticated session and is POSTed to
 * /api/auth/join. The page nudges the user to sign in if they're not
 * already, then auto-posts on mount.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const db = getDb();
	const row = db.prepare(`
		SELECT i.token, i.role, i.email_hint, i.expires_at, i.used_at, l.name AS lab_name
		FROM invites i
		JOIN labs l ON l.id = i.lab_id
		WHERE i.token = ?
	`).get(params.token) as InviteRow | undefined;

	const now = new Date();
	const expired = row ? new Date(row.expires_at) < now : false;
	const used = !!row?.used_at;

	return {
		token: params.token,
		invite: row
			? {
					role: row.role,
					email_hint: row.email_hint,
					lab_name: row.lab_name,
					expires_at: row.expires_at
				}
			: null,
		expired,
		used,
		signedIn: !!locals.user,
		userHasLab: !!locals.user?.lab_id
	};
};
