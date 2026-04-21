import { createHash, randomBytes } from 'crypto';
import { getDb, generateId } from './db';

/**
 * API-key generation and verification for the deploy endpoint.
 *
 * Keys are shown to the operator exactly once at creation; the server
 * stores only the sha256 hash. sha256 is the right hash here (not bcrypt)
 * because (a) the key is already high-entropy random bytes so work
 * factors buy nothing and (b) verification is in a hot path that can't
 * afford bcrypt's 100 ms.
 *
 * Format: `mk_<43-char base64url>` — 32 bytes of randomness.
 */

const KEY_PREFIX = 'mk_';

export interface CreatedKey {
	plaintext: string;
	hash: string;
	display: string;
}

/** Mint a new key. The caller must store the plaintext immediately; we
 *  keep only the hash + display prefix. */
export function mintApiKey(): CreatedKey {
	const raw = randomBytes(32).toString('base64url');
	const plaintext = KEY_PREFIX + raw;
	const hash = sha256(plaintext);
	// Display prefix: enough of the key to identify a row in a list
	// without being useful to an attacker. 10 chars of base64url ≈ 60 bits;
	// keys on the server are selected by full-hash equality, so a leaked
	// display prefix can't narrow a guess meaningfully.
	const display = plaintext.slice(0, KEY_PREFIX.length + 8) + '…';
	return { plaintext, hash, display };
}

export function sha256(s: string): string {
	return createHash('sha256').update(s).digest('hex');
}

export interface AuthenticatedKey {
	id: string;
	lab_id: string;
	name: string;
}

/**
 * Look up a presented bearer token. Returns the owning key row + lab_id,
 * or null if the key doesn't exist, has been revoked, or is malformed.
 *
 * Also bumps `last_used_at`. That's a write per authenticated request,
 * but each request already writes to the runs table downstream, and the
 * last-used timestamp is what lets admins notice dormant keys.
 */
export function authenticateApiKey(token: string): AuthenticatedKey | null {
	if (typeof token !== 'string' || !token.startsWith(KEY_PREFIX) || token.length < 20) {
		return null;
	}
	const db = getDb();
	const row = db
		.prepare(
			`SELECT id, lab_id, name FROM api_keys
			 WHERE key_hash = ? AND revoked_at IS NULL`
		)
		.get(sha256(token)) as AuthenticatedKey | undefined;
	if (!row) return null;
	db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
	return row;
}

/** Extract a bearer token from an Authorization header, or null. */
export function extractBearer(header: string | null): string | null {
	if (!header) return null;
	const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
	return m ? m[1] : null;
}

/** Persist a new key to the DB; returns the row plus the plaintext so
 *  the caller can show it once. */
export function insertApiKey(labId: string, name: string, createdBy: string | null): CreatedKey & { id: string } {
	const db = getDb();
	const id = generateId();
	const key = mintApiKey();
	db.prepare(
		`INSERT INTO api_keys (id, lab_id, name, key_prefix, key_hash, created_by)
		 VALUES (?, ?, ?, ?, ?, ?)`
	).run(id, labId, name, key.display, key.hash, createdBy);
	return { id, ...key };
}
