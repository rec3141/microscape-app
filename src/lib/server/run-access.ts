import type { User } from '$lib/types';
import { getDb } from './db';

export interface AccessibleRun {
	id: string;
	data_path: string;
	visibility: string;
	lab_slug: string;
}

/**
 * The run with this id, if the caller may read it: public, or (signed in) shared,
 * a member of its lab, or granted run_access. undefined otherwise.
 */
export function findAccessibleRun(user: User | null, id: string): AccessibleRun | undefined {
	const uid = user?.id ?? '';
	return getDb().prepare(
		`SELECT r.id, r.data_path, r.visibility, l.slug AS lab_slug
		 FROM runs r
		 JOIN labs l ON l.id = r.lab_id AND l.deleted_at IS NULL
		 LEFT JOIN lab_memberships m
		   ON m.lab_id = r.lab_id AND m.user_id = ? AND m.status = 'active'
		 LEFT JOIN run_access ra
		   ON ra.run_id = r.id AND ra.user_id = ?
		 WHERE r.id = ?
		   AND (
		     r.visibility = 'public'
		     OR (? != '' AND (r.visibility = 'shared' OR m.user_id IS NOT NULL OR ra.user_id IS NOT NULL))
		   )`
	).get(uid, uid, id, uid) as AccessibleRun | undefined;
}
