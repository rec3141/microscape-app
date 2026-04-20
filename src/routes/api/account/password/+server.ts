import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setUserPassword, verifyUserPassword } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { apiError } from '$lib/server/api-errors';
import { requireUser } from '$lib/server/guards';
import { checkRate } from '$lib/server/rate-limit';
import { parseBody } from '$lib/server/validation';
import { ChangeOwnPasswordBody } from '$lib/server/schemas/auth';

/**
 * Change the current user's own password.
 *
 * - Requires the OLD password to be supplied and verified, EVEN if the user
 *   is in the must_change_password=1 state. (Stops a stolen-session attacker
 *   from locking out the legitimate user.)
 * - Validates length on the new password via the zod schema.
 * - Clears must_change_password as a side effect of setUserPassword.
 */
export const POST: RequestHandler = async ({ request, locals, cookies, getClientAddress }) => {
	const user = requireUser(locals);
	if (user.is_demo) {
		return json({ error: 'Demo accounts cannot change passwords' }, { status: 403 });
	}

	if (!checkRate(`password-change:${user.id}:${getClientAddress()}`, 5, 60_000)) {
		return json({ error: 'Too many attempts, try again in a moment' }, { status: 429 });
	}

	const parsed = parseBody(ChangeOwnPasswordBody, await request.json().catch(() => null));
	if (!parsed.ok) return parsed.response;
	const { old_password, new_password } = parsed.data;

	try {
		const ok = await verifyUserPassword(user.id, old_password);
		if (!ok) {
			return json({ error: 'Current password is incorrect' }, { status: 400 });
		}

		// setUserPassword still calls validatePasswordPolicy as defense in
		// depth — the zod schema and the function-level check enforce the
		// same rules so a future caller that bypasses the schema is still safe.
		await setUserPassword(user.id, new_password);

		// Invalidate every OTHER session for this user. If the password change
		// was triggered because of a suspected compromise, the attacker's
		// cookie is killed; the caller's current session stays alive so they
		// don't have to re-log in.
		const currentSessionId = cookies.get('session');
		const db = getDb();
		if (currentSessionId) {
			db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(user.id, currentSessionId);
		} else {
			db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
		}

		return json({ ok: true });
	} catch (err) {
		return apiError(err);
	}
};
