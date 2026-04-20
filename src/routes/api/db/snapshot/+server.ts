import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { commitSnapshot } from '$lib/server/github';
import { requireLabAdmin } from '$lib/server/guards';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { labId } = requireLabAdmin(locals);
	const { message } = await request.json().catch(() => ({ message: '' }));
	const commitMessage = message || `DB snapshot ${new Date().toISOString()}`;

	const result = await commitSnapshot(labId, commitMessage);
	if (!result) {
		throw error(500, 'Snapshot failed — check GITHUB_TOKEN and GITHUB_REPO');
	}

	return json({ ok: true, sha: result.sha, unchanged: result.unchanged ?? false });
};
