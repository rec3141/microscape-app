import type { LayoutServerLoad } from './$types';
import { getDb } from '$lib/server/db';

export const load: LayoutServerLoad = async ({ locals }) => {
	const db = getDb();

	let lab: { id: string; name: string; slug: string } | null = null;
	if (locals.user?.lab_id) {
		lab = db
			.prepare('SELECT id, name, slug FROM labs WHERE id = ?')
			.get(locals.user.lab_id) as { id: string; name: string; slug: string } | null;
	}

	const labs: { id: string; name: string; slug: string; role: string }[] = locals.user
		? (db
				.prepare(
					`SELECT l.id, l.name, l.slug, m.role
					 FROM lab_memberships m
					 JOIN labs l ON l.id = m.lab_id
					 WHERE m.user_id = ? AND m.status = 'active'
					 ORDER BY l.name`
				)
				.all(locals.user.id) as { id: string; name: string; slug: string; role: string }[])
		: [];

	return {
		user: locals.user,
		lab,
		labs
	};
};
