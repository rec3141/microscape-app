import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { requireLabAdmin } from '$lib/server/guards';
import { insertApiKey } from '$lib/server/api-keys';
import { parseBody } from '$lib/server/validation';
import { ApiKeyCreateBody } from '$lib/server/schemas/api-keys';
import { apiError } from '$lib/server/api-errors';

// Admin-gated via hooks.server.ts ADMIN_WRITE_PREFIXES + a GET-admin override.

/** List keys for the caller's lab. Never includes plaintext or the hash. */
export const GET: RequestHandler = async ({ locals }) => {
	const { labId } = requireLabAdmin(locals);
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT id, name, key_prefix, created_at, last_used_at, revoked_at
			 FROM api_keys
			 WHERE lab_id = ?
			 ORDER BY revoked_at IS NOT NULL, created_at DESC`
		)
		.all(labId);
	return json(rows);
};

/** Create a new key. Returns the plaintext ONCE — subsequent reads only
 *  see the prefix. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { user, labId } = requireLabAdmin(locals);
	const parsed = parseBody(ApiKeyCreateBody, await request.json().catch(() => null));
	if (!parsed.ok) return parsed.response;
	try {
		const key = insertApiKey(labId, parsed.data.name, user.id);
		return json(
			{ id: key.id, name: parsed.data.name, key: key.plaintext, prefix: key.display },
			{ status: 201 }
		);
	} catch (err) {
		return apiError(err);
	}
};
