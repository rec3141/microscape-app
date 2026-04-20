import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError } from '$lib/server/api-errors';
import { requireLabAdmin } from '$lib/server/guards';
import { z } from 'zod';
import { parseBody } from '$lib/server/validation';

const FeedbackUpdateBody = z.object({
	status: z.enum(['open', 'resolved', 'wontfix']).optional()
});

/** Lab-admin can mutate feedback in their own lab, plus NULL-lab (anonymous)
 *  rows. Anything belonging to a different lab returns 404 — don't confirm
 *  existence across tenants. */
function assertFeedbackInLabOrNull(
	db: ReturnType<typeof getDb>,
	id: string,
	labId: string
): void {
	const row = db
		.prepare('SELECT lab_id FROM feedback WHERE id = ?')
		.get(id) as { lab_id: string | null } | undefined;
	if (!row) throw error(404, 'Feedback not found');
	if (row.lab_id !== null && row.lab_id !== labId) {
		throw error(404, 'Feedback not found');
	}
}

/** Admin updates the status of a feedback row (open / resolved / wontfix). */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const { labId } = requireLabAdmin(locals);

	const parsed = parseBody(FeedbackUpdateBody, await request.json().catch(() => null));
	if (!parsed.ok) return parsed.response;

	try {
		const db = getDb();
		assertFeedbackInLabOrNull(db, params.id!, labId);
		const result = db
			.prepare('UPDATE feedback SET status = COALESCE(?, status) WHERE id = ?')
			.run(parsed.data.status ?? null, params.id);
		if (result.changes === 0) throw error(404, 'Feedback not found');
		return json(db.prepare('SELECT * FROM feedback WHERE id = ?').get(params.id));
	} catch (err) {
		return apiError(err);
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { labId } = requireLabAdmin(locals);
	try {
		const db = getDb();
		assertFeedbackInLabOrNull(db, params.id!, labId);
		db.prepare('DELETE FROM feedback WHERE id = ?').run(params.id);
		return json({ ok: true });
	} catch (err) {
		return apiError(err);
	}
};
