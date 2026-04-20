import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb, generateId } from '$lib/server/db';
import { setUserPassword } from '$lib/server/auth';
import { apiError } from '$lib/server/api-errors';
import { requireLabAdmin } from '$lib/server/guards';
import { parseBody } from '$lib/server/validation';
import { UserCreateBody } from '$lib/server/schemas/auth';

// Both endpoints require admin via the centralized gate in hooks.server.ts;
// the requireLabAdmin call below also narrows to the caller's lab_id.

// User row shape returned to admins. Includes is_approved + must_change_password
// + auth-source flags but NOT password_hash.
const ADMIN_USER_COLS = `
	u.id, m.lab_id, u.github_id, u.username, u.display_name, u.email, u.avatar_url, u.avatar_emoji,
	m.role, m.status AS membership_status, u.is_local_account, u.is_approved, u.must_change_password,
	u.created_at, u.updated_at,
	(u.password_hash IS NOT NULL) AS has_password
`;

export const GET: RequestHandler = async ({ locals }) => {
	const { labId } = requireLabAdmin(locals);
	const db = getDb();
	// Lab-scoped user list via memberships. Only users with a membership
	// row in this lab are shown — no cross-lab leak of unassigned signups.
	const users = db.prepare(
		`SELECT ${ADMIN_USER_COLS}
		 FROM lab_memberships m
		 JOIN users u ON u.id = m.user_id
		 WHERE m.lab_id = ?
		 ORDER BY u.username`
	).all(labId);
	return json(users);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const { labId } = requireLabAdmin(locals);
	const parsed = parseBody(UserCreateBody, await request.json().catch(() => null));
	if (!parsed.ok) return parsed.response;
	const data = parsed.data;

	try {
		const id = generateId();
		const db = getDb();
		// New admin-created local accounts join the creating admin's lab.
		// The user row is identity-only; lab access is via lab_memberships.
		db.prepare(
			`INSERT INTO users (id, lab_id, active_lab_id, username, display_name, email, role, is_local_account, is_approved, must_change_password)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 1)`
		).run(id, labId, labId, data.username, data.display_name ?? null, data.email ?? null, data.role);
		db.prepare(
			`INSERT INTO lab_memberships (user_id, lab_id, role, status, added_by)
			 VALUES (?, ?, ?, 'active', ?)`
		).run(id, labId, data.role, locals.user!.id);
		await setUserPassword(id, data.password);
		// setUserPassword clears must_change_password — re-set it so the new
		// user is forced to change the temp password on first login.
		db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(id);

		const user = db.prepare(
			`SELECT ${ADMIN_USER_COLS}
			 FROM lab_memberships m
			 JOIN users u ON u.id = m.user_id
			 WHERE u.id = ? AND m.lab_id = ?`
		).get(id, labId);
		return json(user, { status: 201 });
	} catch (err) {
		return apiError(err);
	}
};
