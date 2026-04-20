import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { requireUser } from '$lib/server/guards';
import { checkRate } from '$lib/server/rate-limit';
import { apiError } from '$lib/server/api-errors';

interface InviteRow {
	token: string;
	lab_id: string;
	role: 'admin' | 'user' | 'viewer';
	expires_at: string;
	used_at: string | null;
}

/**
 * Accept a lab-invite token. Caller must be authenticated. Creates (or
 * reactivates) a lab_memberships row with the invite's role. The user's
 * active_lab_id is set to the new lab so they immediately see its data.
 *
 * If the user already has an active membership in the invite's lab, the
 * invite is consumed but no second row is created (idempotent). If the
 * user has a **blocked** membership, the invite is rejected — an admin
 * must explicitly unblock them first.
 */
export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	const user = requireUser(locals);

	const ip = getClientAddress();
	if (!checkRate(`invite-join:${ip}`, 10, 60 * 60_000)) {
		return json({ error: 'Too many join attempts; try again later' }, { status: 429 });
	}

	let token: string;
	try {
		const body = await request.json();
		token = typeof body?.token === 'string' ? body.token.trim() : '';
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	if (!token) return json({ error: 'Token is required' }, { status: 400 });

	try {
		const db = getDb();
		const invite = db
			.prepare(
				'SELECT token, lab_id, role, expires_at, used_at FROM invites WHERE token = ?'
			)
			.get(token) as InviteRow | undefined;
		if (!invite) return json({ error: 'Invite not found' }, { status: 404 });
		if (invite.used_at) return json({ error: 'Invite has already been used' }, { status: 410 });
		if (new Date(invite.expires_at) < new Date()) {
			return json({ error: 'Invite has expired' }, { status: 410 });
		}

		// Check if user is blocked in this lab
		const existing = db
			.prepare('SELECT status FROM lab_memberships WHERE user_id = ? AND lab_id = ?')
			.get(user.id, invite.lab_id) as { status: string } | undefined;
		if (existing?.status === 'blocked') {
			return json(
				{ error: 'Your access to this lab has been blocked. Contact a lab admin to resolve this.' },
				{ status: 403 }
			);
		}

		const tx = db.transaction(() => {
			const consumed = db
				.prepare(
					"UPDATE invites SET used_at = datetime('now'), used_by = ? WHERE token = ? AND used_at IS NULL"
				)
				.run(user.id, token).changes;
			if (consumed === 0) throw new Error('Invite was just used by someone else');

			if (!existing) {
				db.prepare(
					`INSERT INTO lab_memberships (user_id, lab_id, role, status, added_by)
					 VALUES (?, ?, ?, 'active', (SELECT created_by FROM invites WHERE token = ?))`
				).run(user.id, invite.lab_id, invite.role, token);
			}

			// Set legacy fields for backward compat + point active lab here
			db.prepare(
				"UPDATE users SET lab_id = ?, active_lab_id = ?, role = ?, updated_at = datetime('now') WHERE id = ?"
			).run(invite.lab_id, invite.lab_id, invite.role, user.id);
		});
		tx();

		const lab = db.prepare('SELECT id, name, slug FROM labs WHERE id = ?').get(invite.lab_id);
		return json({ lab, role: invite.role });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('just used')) return json({ error: msg }, { status: 409 });
		return apiError(err);
	}
};
