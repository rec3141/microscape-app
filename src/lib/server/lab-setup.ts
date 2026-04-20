import type Database from 'better-sqlite3';
import { generateId } from './db';

/**
 * Lab-setup helpers shared by the self-serve `/api/auth/setup-lab` endpoint
 * and the CLI `scripts/create-lab.mjs` script. Centralizes slug derivation
 * so a lab created via either path lands with the same shape.
 */

/** Derive a url-safe slug from a lab name. Lowercase, alnum + hyphens, no
 *  leading/trailing hyphens. Empty input falls back to "lab". */
export function deriveSlug(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'lab'
	);
}

/**
 * Create a new lab row. Returns the new lab's id. Throws if the slug
 * collides with an existing lab — caller should surface a 409.
 */
export function createLab(db: Database.Database, name: string, slug?: string): string {
	const finalSlug = slug && slug.trim() ? deriveSlug(slug) : deriveSlug(name);
	const existing = db.prepare('SELECT id FROM labs WHERE slug = ?').get(finalSlug);
	if (existing) {
		throw new Error(`Lab slug "${finalSlug}" is already taken`);
	}
	const id = generateId();
	db.prepare('INSERT INTO labs (id, name, slug) VALUES (?, ?, ?)').run(id, name.trim(), finalSlug);
	return id;
}
