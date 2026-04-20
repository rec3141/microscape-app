import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireLabAdmin } from '$lib/server/guards';
import { listSnapshotCommits } from '$lib/server/github';

/** List recent snapshot commits in the lab's GitHub repo, scoped to
 *  paths under data/<lab-slug>/. Powers the Restore picker. Admin-only. */
export const GET: RequestHandler = async ({ locals }) => {
	const { labId } = requireLabAdmin(locals);
	const result = await listSnapshotCommits(labId);
	return json(result);
};
