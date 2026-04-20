import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomBytes } from 'crypto';
import { getDb } from '$lib/server/db';
import { requireLabAdmin } from '$lib/server/guards';
import { apiError } from '$lib/server/api-errors';

const VALID_ROLES = new Set(['admin', 'user', 'viewer']);
const DEFAULT_TTL_DAYS = 14;
const MAX_EMAIL_HINT = 200;

/** List invites for the caller's lab — both active and recently used,
 *  so the admin sees who's accepted what. */
export const GET: RequestHandler = async ({ locals }) => {
	const { labId } = requireLabAdmin(locals);
	const db = getDb();
	const rows = db.prepare(`
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
	return json(rows);
};

/** Generate a new invite token. Admin-only. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { user, labId } = requireLabAdmin(locals);
	let body: { role?: unknown; email_hint?: unknown; ttl_days?: unknown };
	try {
		body = await request.json();
	} catch {
		body = {};
	}

	const role = typeof body.role === 'string' && VALID_ROLES.has(body.role) ? body.role : 'user';
	const emailHint =
		typeof body.email_hint === 'string' && body.email_hint.trim()
			? body.email_hint.trim().slice(0, MAX_EMAIL_HINT)
			: null;
	const ttlDays =
		typeof body.ttl_days === 'number' && body.ttl_days > 0 && body.ttl_days <= 90
			? Math.floor(body.ttl_days)
			: DEFAULT_TTL_DAYS;

	const token = randomBytes(24).toString('base64url');
	const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

	try {
		const db = getDb();
		db.prepare(`
			INSERT INTO invites (token, lab_id, role, email_hint, created_by, expires_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`).run(token, labId, role, emailHint, user.id, expiresAt);
		return json({ token, role, email_hint: emailHint, expires_at: expiresAt }, { status: 201 });
	} catch (err) {
		return apiError(err);
	}
};
