import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { requireLabAdmin } from '$lib/server/guards';
import { apiError } from '$lib/server/api-errors';

interface SettingsRow {
	id: string;
	name: string;
	slug: string;
	github_repo: string | null;
	github_token: string | null;
	backup_interval_hours: number | null;
	last_backup_at: string | null;
}

/** Return the caller's lab settings. The token is masked so it isn't
 *  echoed back to the browser — the admin can see whether one is set
 *  ("●●●●") but not its value. */
export const GET: RequestHandler = async ({ locals }) => {
	const { labId } = requireLabAdmin(locals);
	const db = getDb();
	const lab = db
		.prepare(
			'SELECT id, name, slug, github_repo, github_token, backup_interval_hours, last_backup_at FROM labs WHERE id = ?'
		)
		.get(labId) as SettingsRow | undefined;
	if (!lab) return json({ error: 'Lab not found' }, { status: 404 });
	return json({
		id: lab.id,
		name: lab.name,
		slug: lab.slug,
		github_repo: lab.github_repo,
		github_token_set: !!lab.github_token,
		backup_interval_hours: lab.backup_interval_hours,
		last_backup_at: lab.last_backup_at
	});
};

/** Update lab settings. Treats `github_token === null` as "leave alone"
 *  (so the UI can save other fields without re-typing the secret) and
 *  `github_token === ""` as "clear it". Empty repo string also clears.
 *
 *  `backup_interval_hours` accepts null/0 (off), or a positive integer
 *  capped at 8760 (one year) to prevent absurd values. */
export const PUT: RequestHandler = async ({ request, locals }) => {
	const { labId } = requireLabAdmin(locals);
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const updates: string[] = [];
	const params: (string | number | null)[] = [];

	if ('github_repo' in body) {
		const v = body.github_repo;
		const repo = typeof v === 'string' && v.trim() ? v.trim() : null;
		if (repo && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
			return json({ error: 'github_repo must be in "owner/repo" format' }, { status: 400 });
		}
		updates.push('github_repo = ?');
		params.push(repo);
	}

	if ('github_token' in body && body.github_token !== null) {
		// Empty string explicitly clears; any other string value sets.
		const v = body.github_token;
		if (typeof v !== 'string') {
			return json({ error: 'github_token must be a string' }, { status: 400 });
		}
		const tok = v.trim();
		updates.push('github_token = ?');
		params.push(tok || null);
	}

	if ('backup_interval_hours' in body) {
		const v = body.backup_interval_hours;
		let hours: number | null;
		if (v === null || v === 0 || v === '0' || v === '') {
			hours = null;
		} else {
			const n = Number(v);
			if (!Number.isFinite(n) || n < 1 || n > 8760) {
				return json({ error: 'backup_interval_hours must be 1–8760 or null' }, { status: 400 });
			}
			hours = Math.floor(n);
		}
		updates.push('backup_interval_hours = ?');
		params.push(hours);
	}

	if (updates.length === 0) {
		return json({ error: 'No settings to update' }, { status: 400 });
	}

	try {
		const db = getDb();
		params.push(labId);
		db.prepare(
			`UPDATE labs SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`
		).run(...params);
		return json({ ok: true });
	} catch (err) {
		return apiError(err);
	}
};
