import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError } from '$lib/server/api-errors';
import { requireLabAdmin } from '$lib/server/guards';
import { parseBody } from '$lib/server/validation';
import { UserUpdateBody } from '$lib/server/schemas/auth';

const ADMIN_USER_COLS = `
	u.id, m.lab_id, u.github_id, u.username, u.display_name, u.email, u.avatar_url, u.avatar_emoji,
	m.role, m.status AS membership_status, u.is_local_account, u.is_approved, u.must_change_password,
	u.created_at, u.updated_at,
	(u.password_hash IS NOT NULL) AS has_password
`;

/** Edit role / display fields for a member of this lab. Cannot edit own role (anti-lockout). */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const { user: me, labId } = requireLabAdmin(locals);

	const parsed = parseBody(UserUpdateBody, await request.json().catch(() => null));
	if (!parsed.ok) return parsed.response;
	const data = parsed.data;

	try {
		const db = getDb();
		const membership = db
			.prepare('SELECT user_id, lab_id, role FROM lab_memberships WHERE user_id = ? AND lab_id = ?')
			.get(params.id, labId) as { user_id: string; lab_id: string; role: string } | undefined;
		if (!membership) throw error(404, 'User not found');

		const role = data.role ?? membership.role;

		// Anti-lockout: an admin cannot demote themselves.
		if (params.id === me.id && role !== 'admin') {
			return json(
				{ error: 'You cannot demote yourself. Promote another admin first.' },
				{ status: 400 }
			);
		}

		// Update role on the membership row
		db.prepare(
			`UPDATE lab_memberships SET role = ? WHERE user_id = ? AND lab_id = ?`
		).run(role, params.id, labId);

		// Update display fields on the user identity row
		db.prepare(
			`UPDATE users
			   SET is_approved = COALESCE(?, is_approved),
			       display_name = COALESCE(?, display_name),
			       email = COALESCE(?, email),
			       updated_at = datetime('now')
			 WHERE id = ?`
		).run(
			data.is_approved ?? null,
			data.display_name ?? null,
			data.email ?? null,
			params.id
		);

		const updated = db
			.prepare(`SELECT ${ADMIN_USER_COLS} FROM lab_memberships m JOIN users u ON u.id = m.user_id WHERE m.user_id = ? AND m.lab_id = ?`)
			.get(params.id, labId);
		return json(updated);
	} catch (err) {
		return apiError(err);
	}
};

/** Remove a user from this lab. Deletes their membership row — their user
 *  identity survives for attribution (created_by references, etc.). If the
 *  user's active_lab_id points at this lab, it's cleared so the hooks gate
 *  redirects them to /auth/setup-lab on next request. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { user: me, labId } = requireLabAdmin(locals);
	if (params.id === me.id) {
		return json({ error: 'You cannot remove yourself from the lab' }, { status: 400 });
	}
	try {
		const db = getDb();
		const membership = db
			.prepare('SELECT user_id, role FROM lab_memberships WHERE user_id = ? AND lab_id = ?')
			.get(params.id, labId) as { user_id: string; role: string } | undefined;
		if (!membership) throw error(404, 'User not found');

		// Last-admin guard: don't allow removing the last admin from a lab.
		if (membership.role === 'admin') {
			const adminCount = (db
				.prepare("SELECT COUNT(*) AS n FROM lab_memberships WHERE lab_id = ? AND role = 'admin' AND status = 'active'")
				.get(labId) as { n: number }).n;
			if (adminCount <= 1) {
				return json(
					{ error: 'Cannot remove the last admin. Promote another member to admin first, or delete the lab.' },
					{ status: 400 }
				);
			}
		}

		db.transaction(() => {
			db.prepare('DELETE FROM lab_memberships WHERE user_id = ? AND lab_id = ?').run(params.id, labId);
			db.prepare('DELETE FROM sessions WHERE user_id = ?').run(params.id);
			// Clear active_lab_id if it pointed at this lab
			db.prepare('UPDATE users SET active_lab_id = NULL WHERE id = ? AND active_lab_id = ?').run(params.id, labId);
		})();
		return json({ ok: true });
	} catch (err) {
		return apiError(err);
	}
};
