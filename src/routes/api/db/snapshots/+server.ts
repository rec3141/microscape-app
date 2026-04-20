import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { requireLabAdmin } from '$lib/server/guards';

/** History view of this lab's recent backups. Newest first, capped at 50
 *  rows so the Backup tab can render quickly even on long-lived labs. */
export const GET: RequestHandler = async ({ locals }) => {
	const { labId } = requireLabAdmin(locals);
	const db = getDb();
	const rows = db.prepare(`
		SELECT id, commit_sha, commit_message, status, error_message, is_automatic, created_at
		FROM db_snapshots
		WHERE lab_id = ?
		ORDER BY created_at DESC
		LIMIT 50
	`).all(labId);
	return json(rows);
};
