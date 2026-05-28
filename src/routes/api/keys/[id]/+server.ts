import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { requireLabAdmin } from '$lib/server/guards';
import { parseBody } from '$lib/server/validation';
import { ApiKeyUpdateBody } from '$lib/server/schemas/api-keys';
import { apiError } from '$lib/server/api-errors';

/** Update capabilities on an existing key. Currently only the
 *  can_publish_public flag is toggleable — the key plaintext is never
 *  rotated in place (mint a new key + revoke the old one for that). */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { labId } = requireLabAdmin(locals);
	const parsed = parseBody(ApiKeyUpdateBody, await request.json().catch(() => null));
	if (!parsed.ok) return parsed.response;

	const db = getDb();
	const row = db
		.prepare('SELECT lab_id FROM api_keys WHERE id = ?')
		.get(params.id) as { lab_id: string } | undefined;
	if (!row || row.lab_id !== labId) throw error(404, 'Key not found');

	try {
		db.prepare('UPDATE api_keys SET can_publish_public = ? WHERE id = ?')
			.run(parsed.data.can_publish_public, params.id);
		return json({ ok: true, can_publish_public: parsed.data.can_publish_public });
	} catch (err) {
		return apiError(err);
	}
};

/** Revoke a key — soft-delete via revoked_at. Keeps the row so the UI
 *  can show "was active, revoked on…" and so audit queries joining
 *  run history to keys still resolve. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { labId } = requireLabAdmin(locals);
	const db = getDb();
	const row = db
		.prepare('SELECT lab_id, revoked_at FROM api_keys WHERE id = ?')
		.get(params.id) as { lab_id: string; revoked_at: string | null } | undefined;
	if (!row || row.lab_id !== labId) throw error(404, 'Key not found');
	if (row.revoked_at) return json({ ok: true, already_revoked: true });
	db.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ?").run(params.id);
	return json({ ok: true });
};
