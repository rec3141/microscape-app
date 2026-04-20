import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { setUserPassword } from '$lib/server/auth';
import { apiError } from '$lib/server/api-errors';
import { requireLabAdmin } from '$lib/server/guards';
import { parseBody } from '$lib/server/validation';
import { ResetPasswordBody } from '$lib/server/schemas/auth';

/**
 * Admin resets another user's password to a temporary value.
 *
 * Sets must_change_password=1 so the user is forced to change it on next
 * login. Also revokes all of the user's existing sessions so the old
 * password (if leaked) can't be used to keep an active foothold.
 *
 * Lab-scoped: a lab-admin can only reset passwords for users in their own
 * lab (or unassigned users pending approval). Cross-lab targets 404.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { labId } = requireLabAdmin(locals);

	const parsed = parseBody(ResetPasswordBody, await request.json().catch(() => null));
	if (!parsed.ok) return parsed.response;

	try {
		const db = getDb();
		// Membership-scoped: only reset passwords for users in this lab.
		const membership = db
			.prepare('SELECT user_id FROM lab_memberships WHERE user_id = ? AND lab_id = ?')
			.get(params.id, labId);
		if (!membership) return json({ error: 'User not found' }, { status: 404 });

		// setUserPassword clears must_change_password — re-set it after.
		await setUserPassword(params.id!, parsed.data.password);
		db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(params.id);
		// Revoke any active sessions for this user.
		db.prepare('DELETE FROM sessions WHERE user_id = ?').run(params.id);

		return json({ ok: true });
	} catch (err) {
		return apiError(err);
	}
};
