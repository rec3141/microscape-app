import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireLabAdmin } from '$lib/server/guards';
import { testLabConnection } from '$lib/server/github';

/**
 * Admin-only sanity check for the lab's GitHub backup config: hits
 * GET /repos/<repo>/git/ref/heads/main with the configured token. Used
 * by the Backup tab right after Save Settings to confirm the admin
 * actually has a working setup before they commit to running a full
 * snapshot.
 *
 * GET (no body) — the test is read-only, no inputs needed beyond the
 * caller's lab membership.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const { labId } = requireLabAdmin(locals);
	const result = await testLabConnection(labId);
	return json(result);
};
