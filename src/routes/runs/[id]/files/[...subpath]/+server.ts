import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { requireUser } from '$lib/server/guards';
import { serveRunFile } from '$lib/server/serve-run-file';

/**
 * Canonical gated file endpoint for a single run (looked up by id).
 * Visibility rule: `public OR lab member OR run_access`.
 *
 * The sibling route `/[slug]/[...subpath]` dispatches by slug for
 * compatibility with SPAs that bake an absolute base path matching the
 * run's slug. Both routes end up calling serveRunFile, which handles
 * path-safety, `.gz` fallback, and X-Accel-Redirect emission.
 *
 * See the sibling slug route for why trailingSlash is 'always'.
 */
export const trailingSlash = 'always';
export const GET: RequestHandler = async ({ params, locals, request }) => {
	const user = requireUser(locals);
	const db = getDb();

	const run = db.prepare(
		`SELECT r.id, r.data_path, r.is_public
		 FROM runs r
		 LEFT JOIN lab_memberships m
		   ON m.lab_id = r.lab_id AND m.user_id = ? AND m.status = 'active'
		 LEFT JOIN run_access ra
		   ON ra.run_id = r.id AND ra.user_id = ?
		 WHERE r.id = ?
		   AND (r.is_public = 1 OR m.user_id IS NOT NULL OR ra.user_id IS NOT NULL)`
	).get(user.id, user.id, params.id) as
		| { id: string; data_path: string; is_public: number }
		| undefined;
	if (!run) throw error(404, 'Not found');

	return serveRunFile(run, params.subpath ?? '', {
		acceptEncoding: request.headers.get('accept-encoding')
	});
};
