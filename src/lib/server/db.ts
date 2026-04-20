import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import schema from './schema.sql?raw';
import { startBackupScheduler } from './github';

const DB_PATH = process.env.DB_PATH || 'data/microscape.db';

mkdirSync(dirname(DB_PATH), { recursive: true });

let _db: Database.Database | null = null;

/**
 * Lazy DB init. Schema-driven only — `schema.sql` is the single source of
 * truth for table shape. There is no migration layer; if you add a column
 * or rename a table, the expectation is to wipe the existing DB and
 * re-seed (acceptable while we're pre-real-data; revisit if/when a lab
 * accumulates production-grade content).
 */
export function getDb(): Database.Database {
	if (!_db) {
		_db = new Database(DB_PATH);
		_db.pragma('journal_mode = WAL');
		_db.pragma('foreign_keys = ON');
		_db.exec(schema);
		seedDefaultLab(_db);
		const defaultLabId = getDefaultLabId(_db);
		seedPipelines(_db);
		seedDefaultAdmin(_db, defaultLabId);
		// Periodic GitHub-backup scheduler. No-op if already started; safe
		// to call from the lazy-init path because it just installs a
		// setInterval and returns.
		startBackupScheduler();
	}
	return _db;
}

/**
 * Create the default lab on a fresh install. No-op once any lab exists.
 *
 * Subsequent labs come from self-serve signup (POST /api/auth/setup-lab)
 * or the CLI script (scripts/create-lab.mjs). Both call into the lab-
 * creation helper directly — there's no other way to create a lab.
 */
function seedDefaultLab(db: Database.Database) {
	const existing = (db.prepare('SELECT COUNT(*) AS c FROM labs').get() as { c: number }).c;
	if (existing > 0) return;

	const name = process.env.DEFAULT_LAB_NAME || 'microscape';
	const slug =
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'default';
	const id = generateId();
	db.prepare('INSERT INTO labs (id, name, slug) VALUES (?, ?, ?)').run(id, name, slug);
	console.log(`[seed] Created default lab "${name}" (${slug})`);
}

/** Return the default lab's id — used by post-init seeds. */
export function getDefaultLabId(db: Database.Database): string {
	const row = db.prepare('SELECT id FROM labs ORDER BY created_at ASC LIMIT 1').get() as
		| { id: string }
		| undefined;
	if (!row) throw new Error('No labs exist — seedDefaultLab did not run');
	return row.id;
}

export function generateId(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/** Use a client-supplied id if it matches our id format (32 lowercase hex),
 *  otherwise mint a fresh one. Lets pre-printed QR codes flow through
 *  POST endpoints as the row id for the scanner workflow. The DB will
 *  reject duplicate ids via the primary-key constraint. */
export function resolveId(suggested: unknown): string {
	if (typeof suggested === 'string' && /^[0-9a-f]{32}$/.test(suggested)) {
		return suggested;
	}
	return generateId();
}

/**
 * Seed a default `admin/admin` account if the users table is empty.
 *
 * `must_change_password=1` forces the bootstrap operator to change the
 * password on first login. The seed never runs again once any user exists.
 *
 * SECURITY NOTE: this default password is exploitable until first login.
 * Bootstrap from a private network or SSH tunnel and change the password
 * BEFORE exposing the app on the public internet.
 */
function seedDefaultAdmin(db: Database.Database, defaultLabId: string) {
	const count = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
	if (count > 0) return;

	const id = generateId();
	const hash = bcrypt.hashSync('admin', 12);
	db.prepare(
		`INSERT INTO users (id, lab_id, active_lab_id, username, password_hash, role, is_local_account, is_approved, must_change_password)
		 VALUES (?, ?, ?, 'admin', ?, 'admin', 1, 1, 1)`
	).run(id, defaultLabId, defaultLabId, hash);
	db.prepare(
		`INSERT INTO lab_memberships (user_id, lab_id, role, status)
		 VALUES (?, ?, 'admin', 'active')`
	).run(id, defaultLabId);
	console.log('[seed] Created default admin user (admin/admin) — change the password on first login');
}

/**
 * Seed the canonical list of pipelines on every boot. Upserts by slug so
 * running this again is a no-op; adding a new pipeline here only takes
 * effect on next boot.
 */
function seedPipelines(db: Database.Database) {
	const pipelines: { slug: string; name: string; description: string }[] = [
		{ slug: 'microscape-nf', name: 'microscape-nf', description: 'Amplicon (16S/ITS) pipeline — ASV tables, taxonomy, phylogeny, networks.' },
		{ slug: 'danaseq-nanopore-live', name: 'danaseq nanopore_live', description: 'Per-barcode nanopore classification (kraken/bakta/prokka/sketch/tetra/hmm).' },
		{ slug: 'danaseq-nanopore-assembly', name: 'danaseq nanopore_assembly', description: 'Long-read metagenome assembly (Flye/metaMDBG/myloasm) + mapping.' },
		{ slug: 'danaseq-illumina-assembly', name: 'danaseq illumina_assembly', description: 'Short-read metagenome assembly (Tadpole/Megahit/SPAdes) + mapping.' },
		{ slug: 'danaseq-mag-analysis', name: 'danaseq mag_analysis', description: 'MAG binning, annotation, taxonomy, metabolism, and viz.' }
	];
	const upsert = db.prepare(
		`INSERT INTO pipelines (slug, name, description) VALUES (?, ?, ?)
		 ON CONFLICT(slug) DO UPDATE SET name = excluded.name, description = excluded.description`
	);
	for (const p of pipelines) upsert.run(p.slug, p.name, p.description);
}
