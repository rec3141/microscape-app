import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb, generateId } from '$lib/server/db';
import { checkRate } from '$lib/server/rate-limit';
import { apiError } from '$lib/server/api-errors';
import { requireLabAdmin } from '$lib/server/guards';

const MAX_MESSAGE_LEN = 2000;
const MAX_URL_LEN = 500;

// Admin-only via hooks.server.ts (GET /api/feedback is in ADMIN_WRITE_PREFIXES list).
// Lab-admin only: each admin sees feedback for their own lab plus NULL-lab
// rows (pre-migration / anonymous submissions).
export const GET: RequestHandler = async ({ locals }) => {
	const { labId } = requireLabAdmin(locals);
	const db = getDb();
	const items = db
		.prepare(
			'SELECT * FROM feedback WHERE lab_id = ? OR lab_id IS NULL ORDER BY created_at DESC'
		)
		.all(labId);
	return json(items);
};

// Anonymous POSTs allowed via hooks.server.ts PUBLIC_API_ROUTES allowlist.
// Feedback is lab-scoped when the submitter is signed in; for anonymous
// submissions lab_id is NULL and every lab-admin sees the row in their queue.
export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	try {
		// Rate limit per IP: 5 submissions / minute
		const ip = getClientAddress();
		if (!checkRate(`feedback:${ip}`, 5, 60_000)) {
			return json({ error: 'Too many feedback submissions, try again in a moment' }, { status: 429 });
		}

		const data = await request.json();
		const message = String(data?.message ?? '').trim();
		const pageUrl = String(data?.page_url ?? '').slice(0, MAX_URL_LEN);

		if (!message) {
			return json({ error: 'message is required' }, { status: 400 });
		}
		if (message.length > MAX_MESSAGE_LEN) {
			return json({ error: `message must be at most ${MAX_MESSAGE_LEN} chars` }, { status: 400 });
		}

		const user = locals.user;
		const labId = user?.lab_id ?? null;

		const db = getDb();
		const id = generateId();
		db.prepare(
			'INSERT INTO feedback (id, lab_id, page_url, message, user_id, username) VALUES (?, ?, ?, ?, ?, ?)'
		).run(id, labId, pageUrl, message, user?.id ?? null, user?.username ?? 'anonymous');
		return json({ id }, { status: 201 });
	} catch (err) {
		return apiError(err);
	}
};
