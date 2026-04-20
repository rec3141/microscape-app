import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { requireLabAdmin } from '$lib/server/guards';
import { restoreSnapshot } from '$lib/server/github';
import { apiError } from '$lib/server/api-errors';

/**
 * Replace the lab's data with a snapshot from GitHub. WIPES every lab-
 * scoped row across projects, sites, samples, extracts, plates, preps,
 * runs, analyses, personnel, picklists, primer sets, pcr protocols,
 * sample_values, photos, entity_personnel, run_libraries — and replays
 * them from the JSON files at the chosen commit.
 *
 * Confirmation: body must include `confirm: "<lab name>"` to stop a
 * stolen-cookie one-click restore. Same pattern as DELETE /api/lab.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { labId } = requireLabAdmin(locals);
	let body: { commit_sha?: unknown; confirm?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const commitSha = typeof body.commit_sha === 'string' ? body.commit_sha.trim() : '';
	if (!commitSha) return json({ error: 'commit_sha is required' }, { status: 400 });

	try {
		const db = getDb();
		const lab = db
			.prepare('SELECT id, name FROM labs WHERE id = ?')
			.get(labId) as { id: string; name: string } | undefined;
		if (!lab) return json({ error: 'Lab not found' }, { status: 404 });
		if (typeof body.confirm !== 'string' || body.confirm !== lab.name) {
			return json(
				{ error: `Type the lab name (${lab.name}) into the confirmation field to restore.` },
				{ status: 400 }
			);
		}

		const result = await restoreSnapshot(labId, commitSha);
		if (!result.ok) return json(result, { status: 500 });
		return json(result);
	} catch (err) {
		return apiError(err);
	}
};
