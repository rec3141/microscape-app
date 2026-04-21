import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { requireLabAdmin } from '$lib/server/guards';

export const load: PageServerLoad = async ({ locals }) => {
	const { labId } = requireLabAdmin(locals);
	const db = getDb();

	// Lab's own feedback plus anonymous (lab_id IS NULL) submissions, which
	// every lab-admin can see. Matches the /api/feedback GET visibility rule.
	const items = db.prepare(`
		SELECT id, status, page_url, message, username, user_id, lab_id, created_at
		FROM feedback
		WHERE lab_id = ? OR lab_id IS NULL
		ORDER BY
		  CASE status WHEN 'open' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END,
		  created_at DESC
	`).all(labId);

	return { items };
};
