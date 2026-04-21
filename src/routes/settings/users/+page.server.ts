import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { requireLabAdmin } from '$lib/server/guards';

export const load: PageServerLoad = async ({ locals }) => {
	const { user: me, labId } = requireLabAdmin(locals);
	const db = getDb();

	const users = db.prepare(`
		SELECT u.id, u.username, u.display_name, u.email, u.avatar_url, u.avatar_emoji,
		       u.github_id, u.is_local_account, u.is_demo, u.is_approved,
		       u.must_change_password,
		       m.role, m.status AS membership_status, m.added_at,
		       (u.password_hash IS NOT NULL) AS has_password
		FROM lab_memberships m
		JOIN users u ON u.id = m.user_id
		WHERE m.lab_id = ?
		ORDER BY
			CASE m.role WHEN 'admin' THEN 0 WHEN 'user' THEN 1 ELSE 2 END,
			u.username
	`).all(labId);

	return { users, me_id: me.id };
};
