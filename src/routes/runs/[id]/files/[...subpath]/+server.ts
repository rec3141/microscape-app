import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { findAccessibleRun } from '$lib/server/run-access';
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

	const run = findAccessibleRun(locals.user ?? null, params.id);
	if (!run) throw error(404, 'Not found');

	return serveRunFile(run, params.subpath ?? '', {
		acceptEncoding: request.headers.get('accept-encoding')
	});
};
