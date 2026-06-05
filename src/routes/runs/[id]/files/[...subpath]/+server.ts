import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
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
 * See the sibling slug route for the trailing-slash rationale.
 */
export const trailingSlash = 'ignore';
export const GET: RequestHandler = async ({ params, locals, request, url }) => {
	if (!params.subpath && !url.pathname.endsWith('/')) {
		return new Response(null, {
			status: 308,
			headers: { Location: url.pathname + '/' + url.search }
		});
	}

	const user = locals.user;
	const db = getDb();
	const uid = user?.id ?? '';

	const run = db.prepare(
		`SELECT r.id, r.data_path, r.visibility, l.slug AS lab_slug
		 FROM runs r
		 JOIN labs l ON l.id = r.lab_id
		 LEFT JOIN lab_memberships m
		   ON m.lab_id = r.lab_id AND m.user_id = ? AND m.status = 'active'
		 LEFT JOIN run_access ra
		   ON ra.run_id = r.id AND ra.user_id = ?
		 WHERE r.id = ?
		   AND (
		     r.visibility = 'public'
		     OR (? != '' AND (r.visibility = 'shared' OR m.user_id IS NOT NULL OR ra.user_id IS NOT NULL))
		   )`
	).get(uid, uid, params.id, uid) as
		| { id: string; data_path: string; visibility: string; lab_slug: string }
		| undefined;
	if (!run) throw error(404, 'Not found');

	return serveRunFile(run, params.subpath ?? '', {
		acceptEncoding: request.headers.get('accept-encoding')
	});
};
