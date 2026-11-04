import type { User } from '$lib/types';
import { getDb } from './db';

export interface RunListRow {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	visibility: 'private' | 'shared' | 'public';
	created_at: string;
	pipeline_slug: string;
	pipeline_name: string;
	lab_name: string;
	lab_slug: string;
	access_via: 'public' | 'shared' | 'lab' | 'invited' | null;
	data_path: string;
}

/**
 * Every run the caller can see. Two audiences, two queries:
 *   - Anonymous: only runs with visibility='public'.
 *   - Authenticated: runs in their active lab, plus explicit run_access
 *     grants, plus visibility in ('shared', 'public'). Switching the
 *     active lab in the navbar is how they change which "lab" rows they
 *     see. Visibility is a property of the run, not its owning lab — a
 *     public run stays in its owning lab.
 *
 * Rows carry data_path for server-side checks; strip it before handing
 * rows to a page.
 */
export function listAccessibleRuns(user: User | null): RunListRow[] {
	const db = getDb();

	if (!user) {
		return db.prepare(`
			SELECT
				r.id, r.slug, r.name, r.description, r.visibility, r.created_at, r.data_path,
				p.slug AS pipeline_slug, p.name AS pipeline_name,
				l.name AS lab_name, l.slug AS lab_slug,
				'public' AS access_via
			FROM runs r
			JOIN pipelines p ON p.id = r.pipeline_id
			JOIN labs l ON l.id = r.lab_id AND l.deleted_at IS NULL
			WHERE r.visibility = 'public'
			ORDER BY r.created_at DESC
		`).all() as RunListRow[];
	}

	if (!user.lab_id) return [];

	return db.prepare(`
		SELECT
			r.id, r.slug, r.name, r.description, r.visibility, r.created_at, r.data_path,
			p.slug AS pipeline_slug, p.name AS pipeline_name,
			l.name AS lab_name, l.slug AS lab_slug,
			CASE
				WHEN r.lab_id = ? THEN 'lab'
				WHEN ra.user_id IS NOT NULL THEN 'invited'
				WHEN r.visibility = 'public' THEN 'public'
				WHEN r.visibility = 'shared' THEN 'shared'
				ELSE NULL
			END AS access_via
		FROM runs r
		JOIN pipelines p ON p.id = r.pipeline_id
		JOIN labs l ON l.id = r.lab_id AND l.deleted_at IS NULL
		LEFT JOIN run_access ra
		  ON ra.run_id = r.id AND ra.user_id = ?
		WHERE r.lab_id = ?
		   OR ra.user_id IS NOT NULL
		   OR r.visibility IN ('shared', 'public')
		ORDER BY
		  CASE WHEN r.lab_id = ? THEN 0 ELSE 1 END,
		  r.created_at DESC
	`).all(user.lab_id, user.id, user.lab_id, user.lab_id) as RunListRow[];
}
