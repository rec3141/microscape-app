#!/usr/bin/env node
/**
 * Create a new lab. There is no UI for creating labs — the blast radius
 * (orphaned runs, cross-lab access drift, OAuth landing ambiguity) is too
 * high to expose to lab-admins. This script is the single entry point for
 * provisioning a new tenant.
 *
 * Usage:
 *   node scripts/create-lab.mjs "Lab Name" [slug]
 *   DB_PATH=/opt/microscape-app/data/microscape.db node scripts/create-lab.mjs "Reeves Lab"
 *
 * If slug is omitted it is derived from the name (lowercased, non-alnum → "-").
 * Re-running with an existing slug exits 1 — no duplicates.
 *
 * After creating the lab, add users via /api/invites as an admin of the
 * new lab, or directly: INSERT INTO lab_memberships (user_id, lab_id, role).
 */
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = process.env.DB_PATH || 'data/microscape.db';

const [, , rawName, rawSlug] = process.argv;
if (!rawName) {
	console.error('Usage: node scripts/create-lab.mjs "Lab Name" [slug]');
	process.exit(2);
}

const name = rawName.trim();
const slug = (rawSlug || name)
	.toLowerCase()
	.replace(/[^a-z0-9]+/g, '-')
	.replace(/^-|-$/g, '') || 'lab';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const existing = db.prepare('SELECT id, name FROM labs WHERE slug = ?').get(slug);
if (existing) {
	console.error(`Lab with slug "${slug}" already exists (id=${existing.id}, name="${existing.name}")`);
	process.exit(1);
}

const id = randomBytes(16).toString('hex');
db.prepare('INSERT INTO labs (id, name, slug) VALUES (?, ?, ?)').run(id, name, slug);

db.close();
console.log(`Created lab: id=${id} slug=${slug} name="${name}"`);
console.log('');
console.log('Next steps:');
console.log('  1. Assign users to this lab via the /auth/join invite flow, or');
console.log('     INSERT INTO lab_memberships (user_id, lab_id, role) VALUES (...)');
