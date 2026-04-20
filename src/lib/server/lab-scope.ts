import { error } from '@sveltejs/kit';
import type Database from 'better-sqlite3';

/**
 * Lab-scoped access control helpers.
 *
 * Every top-level entity table carries a `lab_id` column. These helpers read
 * the row's lab_id and throw 404 (not 403 — intentional to avoid leaking the
 * existence of resources in other labs) if it doesn't match the caller's
 * lab_id.
 *
 * Usage in an API handler:
 *
 *   const { labId } = requireLab(locals);
 *   await assertLabOwnsRow(db, 'samples', params.id, labId);  // throws 404 if not
 *   // ... safe to proceed
 *
 * For list endpoints, filter directly in the query:
 *
 *   db.prepare('SELECT * FROM samples WHERE lab_id = ? AND is_deleted = 0').all(labId)
 *
 * Helper constants below enumerate the tables that carry lab_id so the
 * assertion function can't be pointed at a table without the column (which
 * would silently return "not found" for every row).
 */

/** Every table that carries a `lab_id` column directly. Keep in sync with schema.sql.
 *  Note: `users` is NOT here — lab access is via `lab_memberships`, not `users.lab_id`. */
export const LAB_SCOPED_TABLES = new Set<string>([
	'runs',
	'feedback',
	'db_snapshots'
]);

/**
 * Throw 404 if a row doesn't exist OR belongs to another lab.
 *
 * The 404 (not 403) is deliberate: a 403 would tell the caller "this row
 * exists, you just can't see it" — useful signal for an attacker trying to
 * enumerate another lab's data. 404 is indistinguishable from the
 * doesn't-exist case.
 */
export function assertLabOwnsRow(
	db: Database.Database,
	table: string,
	id: string,
	labId: string,
	notFoundMessage?: string
): void {
	if (!LAB_SCOPED_TABLES.has(table)) {
		throw new Error(`assertLabOwnsRow: table "${table}" is not lab-scoped`);
	}
	// table name is validated against the allowlist so this is safe despite
	// the template literal — no user input ever reaches the SQL.
	const row = db
		.prepare(`SELECT lab_id FROM ${table} WHERE id = ?`)
		.get(id) as { lab_id: string | null } | undefined;
	if (!row || row.lab_id !== labId) {
		throw error(404, notFoundMessage ?? 'Not found');
	}
}

/**
 * Assert that an already-fetched row belongs to the caller's lab.
 * Use when you've already loaded the row for other reasons.
 */
export function assertRowInLab(
	row: { lab_id?: string | null } | null | undefined,
	labId: string,
	notFoundMessage?: string
): void {
	if (!row || row.lab_id !== labId) {
		throw error(404, notFoundMessage ?? 'Not found');
	}
}
