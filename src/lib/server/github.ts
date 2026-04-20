import { getDb } from './db';
import { env } from '$env/dynamic/private';
import type Database from 'better-sqlite3';

/**
 * Per-lab GitHub backup. Each lab can configure its own (repo, token) pair
 * via the Backup tab in Manage; if it doesn't, the legacy global
 * GITHUB_REPO / GITHUB_TOKEN env vars are used as a fallback so the
 * original single-lab install keeps working without re-configuration.
 *
 * Snapshot files are written to `data/<lab-slug>/<table>.json` in the
 * configured repo, so multiple labs can share one repo without overwriting
 * each other.
 */

/**
 * Tables included in every snapshot, listed in dependency-safe INSERT order
 * (parents before children) so a restore can replay them straight through.
 *
 * Skipped: feedback (live admin queue), invites (transient + secrets-ish),
 * db_snapshots (this lab's own backup history), sessions, oauth_states,
 * users, labs, pipelines (global).
 */
const TABLES_TO_EXPORT = [
	'runs',
	'run_access'
];

interface GitHubConfig {
	token: string;
	repo: string; // "owner/repo"
}

interface LabRow {
	github_repo: string | null;
	github_token: string | null;
	slug: string;
}

/** Resolve the GitHub config for a lab — prefers per-lab values, falls
 *  back to env vars when the lab hasn't configured its own. Returns null
 *  if neither source has both pieces. */
function resolveLabConfig(db: Database.Database, labId: string): { config: GitHubConfig; lab: LabRow } | null {
	const lab = db
		.prepare('SELECT github_repo, github_token, slug FROM labs WHERE id = ?')
		.get(labId) as LabRow | undefined;
	if (!lab) return null;

	const repo = lab.github_repo || env.GITHUB_REPO;
	const token = lab.github_token || env.GITHUB_TOKEN;
	if (!token || !repo) return null;

	return { config: { token, repo }, lab };
}

/**
 * Quick connectivity check: hits GET ref/heads/main with the lab's
 * configured repo + token. Doesn't push anything; just confirms the
 * permissions chain works before the admin commits to a full snapshot.
 *
 * Returns a structured result so the UI can show an actionable message
 * (rather than a raw GitHub error string).
 */
export async function testLabConnection(
	labId: string
): Promise<{ ok: true } | { ok: false; status: number | null; error: string; hint?: string }> {
	const db = getDb();
	const resolved = resolveLabConfig(db, labId);
	if (!resolved) {
		return {
			ok: false,
			status: null,
			error: 'No GitHub repo and/or token configured for this lab.'
		};
	}
	const { config } = resolved;
	const [owner, repo] = config.repo.split('/');
	if (!owner || !repo) {
		return {
			ok: false,
			status: null,
			error: 'GitHub repo must be in "owner/repo" format.'
		};
	}
	try {
		const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/main`, {
			headers: {
				Authorization: `Bearer ${config.token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28'
			}
		});
		if (res.ok) return { ok: true };

		// Translate the common failure modes into a one-line user-friendly
		// hint so the admin doesn't have to read raw GitHub JSON.
		const body = await res.text();
		let hint: string | undefined;
		if (res.status === 401) {
			hint = 'Token is invalid or expired. Generate a new one and re-paste.';
		} else if (res.status === 403) {
			hint =
				'Token does not have permission for this repo. Check Repository access + Contents: Read and write on the token, and that the org has approved it.';
		} else if (res.status === 404) {
			hint =
				'Repo or main branch not found. Make sure the repo exists, the token can see it, and the repo has at least one commit on the main branch (an empty repo has no main).';
		} else if (res.status === 409) {
			hint = 'Repo exists but is empty. Initialize it with at least one commit (e.g. add a README) and try again.';
		}
		return { ok: false, status: res.status, error: body.slice(0, 500), hint };
	} catch (err) {
		return {
			ok: false,
			status: null,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

/** Export all lab-scoped tables as JSON, filtered by the caller's lab_id.
 *  Prevents cross-lab data leakage into the snapshot repo.
 *
 *  Most tables carry lab_id directly. Junction / child tables filter via
 *  the parent row's lab_id — see the per-table case below. */
export function exportTablesAsJson(labId: string): Record<string, unknown[]> {
	const db = getDb();
	const data: Record<string, unknown[]> = {};
	for (const table of TABLES_TO_EXPORT) {
		switch (table) {
			case 'run_access':
				data[table] = db
					.prepare(
						`SELECT ra.* FROM run_access ra
						 JOIN runs r ON r.id = ra.run_id
						 WHERE r.lab_id = ?`
					)
					.all(labId);
				break;
			default:
				data[table] = db.prepare(`SELECT * FROM ${table} WHERE lab_id = ?`).all(labId);
		}
	}
	return data;
}

/**
 * List recent snapshot commits in the lab's configured GitHub repo.
 * Filters to commits that touched this lab's path (so a shared repo's
 * commits for OTHER labs don't show up). Capped at 30.
 */
export async function listSnapshotCommits(
	labId: string
): Promise<{ ok: true; commits: { sha: string; message: string; date: string }[] } | { ok: false; status: number | null; error: string; hint?: string }> {
	const db = getDb();
	const resolved = resolveLabConfig(db, labId);
	if (!resolved) {
		return { ok: false, status: null, error: 'No GitHub repo and/or token configured for this lab.' };
	}
	const { config, lab } = resolved;
	const [owner, repo] = config.repo.split('/');
	const path = `data/${lab.slug}`;
	try {
		const res = await fetch(
			`https://api.github.com/repos/${owner}/${repo}/commits?path=${encodeURIComponent(path)}&per_page=30`,
			{
				headers: {
					Authorization: `Bearer ${config.token}`,
					Accept: 'application/vnd.github+json',
					'X-GitHub-Api-Version': '2022-11-28'
				}
			}
		);
		if (!res.ok) {
			const body = await res.text();
			return { ok: false, status: res.status, error: body.slice(0, 500) };
		}
		const list = (await res.json()) as Array<{
			sha: string;
			commit: { message: string; author?: { date: string } };
		}>;
		return {
			ok: true,
			commits: list.map((c) => ({
				sha: c.sha,
				message: c.commit.message,
				date: c.commit.author?.date ?? ''
			}))
		};
	} catch (err) {
		return {
			ok: false,
			status: null,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

/**
 * Pull every TABLES_TO_EXPORT JSON file at the given commit and replace
 * the lab's data with it. The whole replace runs in one transaction with
 * deferred FKs so the wipe + reload doesn't trip RESTRICT/NO_ACTION
 * intermediate states.
 *
 * Tables that aren't present in the snapshot (e.g. older snapshots that
 * predate a TABLES_TO_EXPORT addition) are left as zero-row restores —
 * the existing rows for that table are still wiped, since we can't
 * partial-restore safely.
 *
 * Override: every restored row's `lab_id` is forcibly set to the caller's
 * current lab id, in case a snapshot is restored into a different lab
 * (forking from another lab's repo).
 *
 * Returns counts per-table on success, or a structured error.
 */
export async function restoreSnapshot(
	labId: string,
	commitSha: string
): Promise<
	| { ok: true; counts: Record<string, number>; missing: string[] }
	| { ok: false; status: number | null; error: string; hint?: string }
> {
	const db = getDb();
	const resolved = resolveLabConfig(db, labId);
	if (!resolved) {
		return { ok: false, status: null, error: 'No GitHub repo and/or token configured for this lab.' };
	}
	const { config, lab } = resolved;
	const [owner, repo] = config.repo.split('/');

	// Fetch each table's JSON at the requested commit. Missing files (404)
	// are tolerated — we record them in `missing` and treat as empty data.
	const fetched: Record<string, unknown[]> = {};
	const missing: string[] = [];
	for (const table of TABLES_TO_EXPORT) {
		const path = `data/${lab.slug}/${table}.json`;
		const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(commitSha)}`;
		const res = await fetch(url, {
			headers: {
				Authorization: `Bearer ${config.token}`,
				Accept: 'application/vnd.github.raw+json',
				'X-GitHub-Api-Version': '2022-11-28'
			}
		});
		if (res.status === 404) {
			missing.push(table);
			fetched[table] = [];
			continue;
		}
		if (!res.ok) {
			const body = await res.text();
			return {
				ok: false,
				status: res.status,
				error: `Fetching ${path}: ${body.slice(0, 300)}`
			};
		}
		try {
			fetched[table] = (await res.json()) as unknown[];
		} catch (err) {
			return {
				ok: false,
				status: null,
				error: `Parsing ${path} as JSON failed: ${err instanceof Error ? err.message : err}`
			};
		}
	}

	// Replay into the DB. Wipe in reverse-dependency order, insert in
	// dependency order — but with deferred FKs the order is mostly
	// cosmetic (the engine checks at commit). Schema-evolution safety:
	// build INSERT column lists from the actual table_info, intersected
	// with the snapshot row keys, so a snapshot that pre-dates a new
	// column doesn't error on the missing key.
	const counts: Record<string, number> = {};
	try {
		db.transaction(() => {
			db.pragma('defer_foreign_keys = ON');
			// Wipe existing lab data, child tables first to be tidy.
			for (const t of [...TABLES_TO_EXPORT].reverse()) {
				wipeLabTable(db, t, labId);
			}
			// Re-insert in declared order.
			for (const t of TABLES_TO_EXPORT) {
				counts[t] = restoreTable(db, t, fetched[t], labId);
			}
		})();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, status: null, error: msg };
	}

	return { ok: true, counts, missing };
}

/** DELETE all rows for `table` belonging to this lab. Mirrors the lab-
 *  scoping logic in exportTablesAsJson. */
function wipeLabTable(db: Database.Database, table: string, labId: string) {
	switch (table) {
		case 'run_access':
			db.prepare(
				'DELETE FROM run_access WHERE run_id IN (SELECT id FROM runs WHERE lab_id = ?)'
			).run(labId);
			break;
		default:
			db.prepare(`DELETE FROM ${table} WHERE lab_id = ?`).run(labId);
	}
}

/** INSERT every row from `rows` into `table`, building the column list
 *  from the intersection of the table's actual columns and the row's
 *  keys (so snapshots that pre-date a column addition don't error).
 *  Forces lab_id to the restoring lab's id for tables that have one. */
function restoreTable(
	db: Database.Database,
	table: string,
	rows: unknown[],
	labId: string
): number {
	if (!rows || rows.length === 0) return 0;
	const tableCols = new Set(
		(db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
	);
	const hasLabId = tableCols.has('lab_id');
	const sample = rows[0] as Record<string, unknown>;
	const keys = Object.keys(sample).filter((k) => tableCols.has(k));
	if (keys.length === 0) return 0;
	const placeholders = keys.map(() => '?').join(',');
	const stmt = db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`);
	let n = 0;
	for (const raw of rows) {
		const row = raw as Record<string, unknown>;
		const values = keys.map((k) => (k === 'lab_id' && hasLabId ? labId : row[k] ?? null));
		stmt.run(...values);
		n++;
	}
	return n;
}

/**
 * Commit a snapshot of this lab's tables to the lab's configured GitHub
 * repo. Always logs an entry in `db_snapshots` — `pushed` on success,
 * `failed` on any error (with the error message preserved for the UI).
 *
 * `automatic` is true when invoked by the periodic scheduler; false when
 * an admin clicks Backup Now.
 */
export async function commitSnapshot(
	labId: string,
	message: string,
	options: { automatic?: boolean } = {}
): Promise<{ sha: string; unchanged?: boolean } | null> {
	const automatic = options.automatic ? 1 : 0;
	const db = getDb();
	const resolved = resolveLabConfig(db, labId);
	if (!resolved) {
		db.prepare(
			`INSERT INTO db_snapshots (lab_id, commit_sha, commit_message, status, error_message, is_automatic)
			 VALUES (?, NULL, ?, 'failed', ?, ?)`
		).run(labId, message, 'No GitHub repo/token configured for this lab', automatic);
		return null;
	}
	const { config, lab } = resolved;
	const data = exportTablesAsJson(labId);
	const [owner, repo] = config.repo.split('/');
	const labPathPrefix = `data/${lab.slug}`;

	try {
		// Get the default branch ref
		const refRes = await ghApi(config, `GET /repos/${owner}/${repo}/git/ref/heads/main`);
		const latestSha = refRes.object.sha;

		// Get the commit to find the tree
		const commitRes = await ghApi(config, `GET /repos/${owner}/${repo}/git/commits/${latestSha}`);
		const baseTreeSha = commitRes.tree.sha;

		// Create blobs for each table
		const tree: { path: string; mode: string; type: string; sha: string }[] = [];
		for (const [table, rows] of Object.entries(data)) {
			const content = JSON.stringify(rows, null, 2);
			const blobRes = await ghApi(config, `POST /repos/${owner}/${repo}/git/blobs`, {
				content,
				encoding: 'utf-8'
			});
			tree.push({
				path: `${labPathPrefix}/${table}.json`,
				mode: '100644',
				type: 'blob',
				sha: blobRes.sha
			});
		}

		// Create tree
		const treeRes = await ghApi(config, `POST /repos/${owner}/${repo}/git/trees`, {
			base_tree: baseTreeSha,
			tree
		});

		// Skip the commit if nothing changed since the last snapshot. Git
		// deduplicates trees by content hash, so if every blob is identical
		// to what already exists at this path, the new tree's SHA equals
		// the parent commit's tree SHA — meaning a fresh commit would be
		// empty. Don't make it (keeps the GitHub commit list clean) and
		// don't pollute db_snapshots history with a no-op row either.
		// Bumps last_backup_at though, so the scheduler knows we checked
		// and doesn't keep retrying every tick.
		if (treeRes.sha === baseTreeSha) {
			db.prepare("UPDATE labs SET last_backup_at = datetime('now') WHERE id = ?").run(labId);
			return { sha: latestSha, unchanged: true };
		}

		// Create commit
		const newCommitRes = await ghApi(config, `POST /repos/${owner}/${repo}/git/commits`, {
			message,
			tree: treeRes.sha,
			parents: [latestSha]
		});

		// Update ref
		await ghApi(config, `PATCH /repos/${owner}/${repo}/git/refs/heads/main`, {
			sha: newCommitRes.sha
		});

		// Log + bump last_backup_at on the lab so the scheduler knows when to
		// next run. Wrapped in a transaction so a partial write here doesn't
		// leave a half-recorded snapshot.
		db.transaction(() => {
			db.prepare(
				`INSERT INTO db_snapshots (lab_id, commit_sha, commit_message, status, is_automatic)
				 VALUES (?, ?, ?, 'pushed', ?)`
			).run(labId, newCommitRes.sha, message, automatic);
			db.prepare("UPDATE labs SET last_backup_at = datetime('now') WHERE id = ?").run(labId);
		})();

		return { sha: newCommitRes.sha };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('GitHub snapshot failed:', msg);
		db.prepare(
			`INSERT INTO db_snapshots (lab_id, commit_sha, commit_message, status, error_message, is_automatic)
			 VALUES (?, NULL, ?, 'failed', ?, ?)`
		).run(labId, message, msg.slice(0, 1000), automatic);
		return null;
	}
}

async function ghApi(config: GitHubConfig, endpoint: string, body?: unknown): Promise<any> {
	const [method, path] = endpoint.split(' ');
	const url = path.startsWith('http') ? path : `https://api.github.com${path}`;

	const res = await fetch(url, {
		method,
		headers: {
			Authorization: `Bearer ${config.token}`,
			Accept: 'application/vnd.github+json',
			'Content-Type': 'application/json',
			'X-GitHub-Api-Version': '2022-11-28'
		},
		body: body ? JSON.stringify(body) : undefined
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`GitHub API ${endpoint}: ${res.status} ${text}`);
	}

	return res.json();
}

/**
 * Periodic backup scheduler. Started once on the first getDb() call. Wakes
 * every 15 minutes, finds labs whose `backup_interval_hours` is set and
 * whose `last_backup_at` is older than that interval, and runs an
 * automatic snapshot for each.
 *
 * Conservative cadence: a 24-hour-interval lab will fire approximately at
 * 24h ± 15min. Good enough — backups don't need to be punctual, they just
 * need to happen.
 */
const SCHEDULER_TICK_MS = 15 * 60_000;
let _schedulerStarted = false;

export function startBackupScheduler() {
	if (_schedulerStarted) return;
	_schedulerStarted = true;

	const tick = async () => {
		try {
			const db = getDb();
			const due = db.prepare(`
				SELECT id, name, last_backup_at, backup_interval_hours
				FROM labs
				WHERE backup_interval_hours IS NOT NULL AND backup_interval_hours > 0
				  AND (
				    last_backup_at IS NULL
				    OR (julianday('now') - julianday(last_backup_at)) * 24 >= backup_interval_hours
				  )
			`).all() as { id: string; name: string; last_backup_at: string | null; backup_interval_hours: number }[];

			for (const lab of due) {
				const msg = `Auto snapshot ${new Date().toISOString()}`;
				console.log(`[backup-scheduler] running for lab ${lab.name} (${lab.id})`);
				// Sequential — avoid hitting GitHub's secondary rate limit
				// when many labs are due at once.
				await commitSnapshot(lab.id, msg, { automatic: true });
			}
		} catch (err) {
			console.error('[backup-scheduler] tick failed:', err instanceof Error ? err.message : err);
		}
	};

	// First tick fires after the interval, not on boot — so a quick restart
	// loop doesn't spam the GitHub API.
	setInterval(tick, SCHEDULER_TICK_MS);
	console.log(`[backup-scheduler] started (tick every ${SCHEDULER_TICK_MS / 60_000} min)`);
}
