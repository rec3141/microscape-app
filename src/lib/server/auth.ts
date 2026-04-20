import { GitHub } from 'arctic';
import bcrypt from 'bcrypt';
import { getDb, generateId } from './db';
import { env } from '$env/dynamic/private';
import type { User } from '$lib/types';

// Columns to select when loading a user for session/locals.
// IMPORTANT: never include `password_hash` here — locals.user flows to every
// page via +layout.server.ts, so anything in this list ends up in client HTML.
//
// Two variants:
//   USER_COLS         — standalone query, no lab_memberships join needed.
//                       lab_id defaults to active_lab_id, role defaults to 'user'.
//                       Used by upsertGitHubUser / createLocalUser where there
//                       may be no membership row yet.
//   USER_MEMBERSHIP_COLS — requires a LEFT JOIN on lab_memberships aliased as `m`.
//                       lab_id and role are sourced from the active membership.
//                       Used by validateSession / verifyLocalUser.
const USER_COLS = `
	u.id, u.active_lab_id AS lab_id, u.github_id, u.username, u.display_name, u.email, u.avatar_url, u.avatar_emoji,
	'user' AS role, u.is_local_account, u.is_demo, u.is_approved, u.must_change_password,
	u.created_at, u.updated_at
`;
const USER_MEMBERSHIP_COLS = `
	u.id, m.lab_id, u.github_id, u.username, u.display_name, u.email, u.avatar_url, u.avatar_emoji,
	COALESCE(m.role, 'user') AS role, u.is_local_account, u.is_demo, u.is_approved, u.must_change_password,
	u.created_at, u.updated_at
`;

// GitHub OAuth client (initialized lazily)
let _github: GitHub | null = null;

export function getGitHub(): GitHub | null {
	if (_github) return _github;
	const clientId = env.GITHUB_CLIENT_ID;
	const clientSecret = env.GITHUB_CLIENT_SECRET;
	if (!clientId || !clientSecret) return null;
	_github = new GitHub(clientId, clientSecret, null);
	return _github;
}

export function getAuthMode(): 'local' | 'github' | 'hybrid' {
	return (env.AUTH_MODE as 'local' | 'github' | 'hybrid') || 'local';
}

// ============================================================
// Sessions
// ============================================================

const SESSION_DURATION_DAYS = 14;
const BCRYPT_COST = 12;

/** True if the configured public ORIGIN is HTTPS — used to set Secure on cookies. */
export function isSecureOrigin(): boolean {
	return (env.ORIGIN || '').startsWith('https://');
}

/** Standard session cookie options used by both login flows. */
export function sessionCookieOptions() {
	return {
		path: '/',
		httpOnly: true,
		secure: isSecureOrigin(),
		maxAge: SESSION_DURATION_DAYS * 24 * 60 * 60,
		sameSite: 'lax' as const
	};
}

export function createSession(userId: string): string {
	const db = getDb();
	const id = generateId();
	const expiresAt = new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
	db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(id, userId, expiresAt);
	return id;
}

export function validateSession(sessionId: string): User | null {
	const db = getDb();
	const row = db.prepare(`
		SELECT ${USER_MEMBERSHIP_COLS}
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		LEFT JOIN lab_memberships m
		  ON m.user_id = u.id AND m.lab_id = u.active_lab_id AND m.status = 'active'
		WHERE s.id = ?
		  AND s.expires_at > datetime('now')
	`).get(sessionId) as User | undefined;
	return row ?? null;
}

export function deleteSession(sessionId: string) {
	const db = getDb();
	db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function deleteExpiredSessions() {
	const db = getDb();
	db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

export function deleteExpiredOauthStates() {
	const db = getDb();
	db.prepare("DELETE FROM oauth_states WHERE expires_at <= datetime('now')").run();
}

// Periodic sweep — runs at most once per 5 minutes per process. Cheap because
// the predicates are indexed and the tables stay tiny.
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 5 * 60_000;
export function maybeSweepExpired() {
	const now = Date.now();
	if (now - lastSweep < SWEEP_INTERVAL_MS) return;
	lastSweep = now;
	try {
		deleteExpiredSessions();
		deleteExpiredOauthStates();
	} catch (err) {
		console.error('[auth] expired sweep failed', err instanceof Error ? err.message : err);
	}
}

// ============================================================
// GitHub user upsert
// ============================================================

export function upsertGitHubUser(githubUser: {
	id: number;
	login: string;
	name: string | null;
	email: string | null;
	avatar_url: string | null;
}): User {
	const db = getDb();
	// Find by github_id without is_deleted filter. A previously removed user
	// can re-authenticate; they'll have no lab_memberships row and land at
	// /auth/setup-lab where they can accept a fresh invite.
	const existing = db
		.prepare(`SELECT ${USER_COLS} FROM users u WHERE u.github_id = ?`)
		.get(githubUser.id) as User | undefined;

	if (existing) {
		// Re-enable the account (clears legacy is_deleted + is_approved flags)
		// so the user can get a session. Without a membership they can't see
		// any lab data — the hooks gate handles that.
		db.prepare(`
			UPDATE users
			SET username = ?, display_name = ?, email = ?, avatar_url = ?,
			    is_approved = 1, is_deleted = 0, updated_at = datetime('now')
			WHERE github_id = ?
		`).run(githubUser.login, githubUser.name, githubUser.email, githubUser.avatar_url, githubUser.id);
		return db
			.prepare(`SELECT ${USER_COLS} FROM users u WHERE u.github_id = ?`)
			.get(githubUser.id) as User;
	}

	const id = generateId();
	// New GitHub-OAuth signups get is_approved=1 (self-serve) and no
	// active_lab_id. The hooks gate redirects them to /auth/setup-lab
	// where they either start their own lab or accept an invite.
	db.prepare(`
		INSERT INTO users (id, github_id, username, display_name, email, avatar_url, role, is_local_account, is_approved)
		VALUES (?, ?, ?, ?, ?, ?, 'user', 0, 1)
	`).run(id, githubUser.id, githubUser.login, githubUser.name, githubUser.email, githubUser.avatar_url);
	return db.prepare(`SELECT ${USER_COLS} FROM users u WHERE u.id = ?`).get(id) as User;
}

// ============================================================
// Local auth
// ============================================================

export async function createLocalUser(username: string, password: string, role: string = 'user'): Promise<User> {
	const db = getDb();
	const id = generateId();
	const hash = await bcrypt.hash(password, BCRYPT_COST);
	db.prepare(`
		INSERT INTO users (id, username, password_hash, role, is_local_account)
		VALUES (?, ?, ?, ?, 1)
	`).run(id, username, hash, role);
	return db.prepare(`SELECT ${USER_COLS} FROM users u WHERE u.id = ?`).get(id) as User;
}

// Password length policy. Applied on password SET (registration / change),
// NOT on verify — so the seeded admin/admin bootstrap can still sign in once.
export const MIN_PASSWORD_LEN = 10;
export const MAX_PASSWORD_LEN = 128;

/** Throws an Error with a safe message if the password doesn't meet policy. */
export function validatePasswordPolicy(password: string) {
	if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) {
		throw new Error(`Password must be ${MIN_PASSWORD_LEN}–${MAX_PASSWORD_LEN} characters`);
	}
}

/**
 * Set a new password for a user. Always clears the must_change_password flag.
 * Caller is responsible for verifying the OLD password (or for skipping the
 * verify when an admin is resetting someone else's password).
 */
export async function setUserPassword(userId: string, newPassword: string) {
	validatePasswordPolicy(newPassword);
	const db = getDb();
	const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
	db.prepare(
		`UPDATE users
		   SET password_hash = ?, must_change_password = 0, is_local_account = 1, updated_at = datetime('now')
		 WHERE id = ?`
	).run(hash, userId);
}

/** Verify the current password of a user; returns true if it matches. */
export async function verifyUserPassword(userId: string, password: string): Promise<boolean> {
	const db = getDb();
	const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
		| { password_hash: string | null }
		| undefined;
	if (!row?.password_hash) return false;
	return bcrypt.compare(password, row.password_hash);
}

// Dummy hash used to keep verifyLocalUser timing constant when the username
// doesn't exist. Must use the same cost as real password hashes — otherwise
// bcrypt.compare takes less wall-clock time for unknown usernames than for
// known ones, re-opening the enumeration channel this is meant to close.
const DUMMY_BCRYPT_HASH = bcrypt.hashSync('does-not-matter', BCRYPT_COST);

export async function verifyLocalUser(username: string, password: string): Promise<User | null> {
	const db = getDb();
	// is_deleted kept in this predicate as defense-in-depth for password auth.
	const row = db
		.prepare('SELECT id, password_hash FROM users WHERE username = ? AND is_local_account = 1 AND is_deleted = 0')
		.get(username) as { id: string; password_hash: string } | undefined;

	// Always run bcrypt.compare so unknown-username and wrong-password take
	// the same wall-clock time (mitigates username enumeration).
	const hash = row?.password_hash ?? DUMMY_BCRYPT_HASH;
	const valid = await bcrypt.compare(password, hash);
	if (!row || !valid) return null;

	return db.prepare(`
		SELECT ${USER_MEMBERSHIP_COLS}
		FROM users u
		LEFT JOIN lab_memberships m
		  ON m.user_id = u.id AND m.lab_id = u.active_lab_id AND m.status = 'active'
		WHERE u.id = ?
	`).get(row.id) as User;
}
