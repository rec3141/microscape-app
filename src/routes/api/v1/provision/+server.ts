import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getDb, generateId } from '$lib/server/db';
import { createLab } from '$lib/server/lab-setup';
import { insertApiKey } from '$lib/server/api-keys';
import { extractBearer } from '$lib/server/api-keys';

/**
 * POST /api/v1/provision — service-to-service provisioning for OMC.
 *
 * OMC deploys each user's amplicon results into a dedicated `omc-<login>` lab so
 * the user only ever authenticates with GitHub (shared OAuth) and never handles
 * a cross-domain key. This endpoint is idempotent: it ensures the lab, the user
 * (by github_id), and the membership exist, rotates the lab's OMC deploy key, and
 * returns the fresh key for the caller to use against /api/v1/deploy.
 *
 * Auth: `Authorization: Bearer <OMC_PROVISION_TOKEN>` — a shared service secret,
 * NOT a lab `mk_` key. Allowlisted in hooks.server.ts so no session is required.
 *
 * Body (JSON): { github_id: number, github_login: string,
 *                display_name?: string, email?: string, avatar_url?: string }
 * Response:    { lab_slug, lab_id, deploy_key }
 */
export const POST: RequestHandler = async ({ request }) => {
	const expected = env.OMC_PROVISION_TOKEN;
	if (!expected) {
		return json({ error: 'Provisioning is not configured (OMC_PROVISION_TOKEN unset)' }, { status: 503 });
	}
	const token = extractBearer(request.headers.get('authorization'));
	if (!token || token !== expected) {
		return json({ error: 'Invalid or missing provisioning token' }, { status: 401 });
	}

	let body: {
		github_id?: number;
		github_login?: string;
		display_name?: string;
		email?: string;
		avatar_url?: string;
	};
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const githubId = Number(body.github_id);
	const login = (body.github_login || '').trim();
	if (!Number.isInteger(githubId) || githubId <= 0 || !login) {
		return json({ error: 'github_id (positive integer) and github_login are required' }, { status: 400 });
	}
	// Restrict username to what deriveSlug / usernames tolerate.
	if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) {
		return json({ error: 'github_login must be a GitHub username (alnum + hyphen)' }, { status: 400 });
	}

	const db = getDb();
	const labSlug = `omc-${login.toLowerCase()}`;

	try {
		const result = db.transaction(() => {
			// 1. Ensure the lab.
			let lab = db.prepare('SELECT id FROM labs WHERE slug = ?').get(labSlug) as { id: string } | undefined;
			const labId = lab ? lab.id : createLab(db, `OMC · ${login}`, labSlug);

			// 2. Ensure the user (matched by github_id, like the OAuth flow).
			let user = db.prepare('SELECT id, active_lab_id FROM users WHERE github_id = ?').get(githubId) as
				| { id: string; active_lab_id: string | null }
				| undefined;
			if (!user) {
				const uid = generateId();
				db.prepare(
					`INSERT INTO users (id, github_id, username, display_name, email, avatar_url,
					                    role, is_local_account, is_approved)
					 VALUES (?, ?, ?, ?, ?, ?, 'user', 0, 1)`
				).run(uid, githubId, login, body.display_name ?? null, body.email ?? null, body.avatar_url ?? null);
				user = { id: uid, active_lab_id: null };
			}

			// 3. Ensure membership; land them on this lab if they have no active lab.
			db.prepare(
				`INSERT INTO lab_memberships (user_id, lab_id, role, status)
				 VALUES (?, ?, 'admin', 'active')
				 ON CONFLICT(user_id, lab_id) DO UPDATE SET status = 'active'`
			).run(user.id, labId);
			if (!user.active_lab_id) {
				db.prepare('UPDATE users SET active_lab_id = ? WHERE id = ?').run(labId, user.id);
			}

			// 4. Rotate the OMC deploy key (one active key per lab).
			db.prepare(
				`UPDATE api_keys SET revoked_at = datetime('now')
				 WHERE lab_id = ? AND name = 'omc-deploy' AND revoked_at IS NULL`
			).run(labId);
			// can_publish_public=1: OMC deploys its viz runs as public so the
			// "Explore Data" link works for authors, collaborators and reviewers
			// without a microscape.app login. Without it /api/v1/deploy 403s.
			const key = insertApiKey(labId, 'omc-deploy', user.id, 1);

			return { lab_slug: labSlug, lab_id: labId, deploy_key: key.plaintext };
		})();

		return json(result);
	} catch (err) {
		console.error('[provision] failed:', err);
		return json({ error: 'Provisioning failed' }, { status: 500 });
	}
};
