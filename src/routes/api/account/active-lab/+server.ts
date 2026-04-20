import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { requireUser } from '$lib/server/guards';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireUser(locals);

	let labId: string;
	try {
		const body = await request.json();
		labId = typeof body?.lab_id === 'string' ? body.lab_id.trim() : '';
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	if (!labId) return json({ error: 'lab_id is required' }, { status: 400 });

	const db = getDb();
	const membership = db
		.prepare("SELECT user_id FROM lab_memberships WHERE user_id = ? AND lab_id = ? AND status = 'active'")
		.get(user.id, labId);
	if (!membership) {
		return json({ error: 'You do not have an active membership in that lab' }, { status: 403 });
	}

	db.prepare('UPDATE users SET active_lab_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
		.run(labId, user.id);

	return json({ ok: true });
};
