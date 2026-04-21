import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { requireUser } from '$lib/server/guards';
import { serveRunFile } from '$lib/server/serve-run-file';

/**
 * SvelteKit's default trailingSlash='never' strips /<slug>/ down to
 * /<slug>, which breaks the SPA's relative asset refs (./assets/…
 * emitted by `vite build --base ./`): without a trailing slash on the
 * document URL, the browser treats /<slug> as a file at the root, and
 * ./assets/index.js resolves to /assets/index.js (404).
 *
 * Setting 'always' would fix /<slug> → /<slug>/ but also wrongly
 * appends a slash to /<slug>/assets/foo.js, breaking every asset
 * fetch. So we use 'ignore' (no automatic normalization either way)
 * and handle the one case we care about in the handler below: the
 * SPA root `/<slug>` with no subpath gets a 308 to `/<slug>/`. Every
 * other URL (with file extension or subpath) is served as-is.
 */
export const trailingSlash = 'ignore';

/**
 * Slug-based alias for /runs/[id]/files/[...subpath].
 *
 * Lab viz SPAs are typically built with an absolute base path matching the
 * run's slug (e.g. `base: "/chesterfield/"`), so asset URLs emitted by the
 * build reference `/chesterfield/assets/...`. Serving them behind the
 * canonical `/runs/<id>/files/` URL breaks those absolute references. This
 * route catches the slug at the root and dispatches the same ACL-gated
 * file delivery.
 *
 * Resolution: find the run whose slug matches AND the caller has access to.
 * When multiple labs share a slug, prefer the caller's active lab, then any
 * lab they're a member of, then public runs elsewhere.
 *
 * Slug collisions with top-level app routes are prevented at run registration
 * time via the RESERVED_SLUGS list in schemas/runs.ts. SvelteKit's route
 * ordering also ensures a more-specific route (e.g. /settings) always wins
 * over this catch-all.
 */
export const GET: RequestHandler = async ({ params, locals, request, url }) => {
	// Redirect /<slug> → /<slug>/ so ./ relative URLs in the SPA resolve
	// under the slug, not the domain root. Only applies when there's no
	// further subpath (asset/data requests already resolve correctly).
	if (!params.subpath && !url.pathname.endsWith('/')) {
		return new Response(null, {
			status: 308,
			headers: { Location: url.pathname + '/' + url.search }
		});
	}

	const user = requireUser(locals);
	const db = getDb();

	const run = db.prepare(
		`SELECT r.id, r.data_path, r.is_public
		 FROM runs r
		 LEFT JOIN lab_memberships m
		   ON m.lab_id = r.lab_id AND m.user_id = ? AND m.status = 'active'
		 LEFT JOIN run_access ra
		   ON ra.run_id = r.id AND ra.user_id = ?
		 WHERE r.slug = ?
		   AND (r.is_public = 1 OR m.user_id IS NOT NULL OR ra.user_id IS NOT NULL)
		 ORDER BY
		   CASE WHEN r.lab_id = ? THEN 0 ELSE 1 END,
		   CASE
		     WHEN m.user_id IS NOT NULL THEN 0
		     WHEN ra.user_id IS NOT NULL THEN 1
		     ELSE 2
		   END,
		   r.created_at DESC
		 LIMIT 1`
	).get(user.id, user.id, params.slug, user.lab_id ?? '') as
		| { id: string; data_path: string; is_public: number }
		| undefined;
	if (!run) throw error(404, 'Not found');

	return serveRunFile(run, params.subpath ?? '', {
		acceptEncoding: request.headers.get('accept-encoding')
	});
};
