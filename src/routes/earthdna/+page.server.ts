import type { PageServerLoad } from './$types';
import { existsSync } from 'fs';
import { join } from 'path';
import { listAccessibleRuns } from '$lib/server/run-list';

/**
 * EarthDNA: every amplicon run the caller can see whose PLACE_GLOBE step
 * wrote data/globe.json(.gz), overlaid on the reference globe in
 * static/earthdna/. The page fetches each run's files through the gated
 * /runs/<id>/files/ route, so access is checked again per file.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const runs = listAccessibleRuns(locals.user ?? null)
		.filter((r) => ['globe.json.gz', 'globe.json'].some((f) => existsSync(join(r.data_path, 'data', f))))
		.map((r) => ({ id: r.id, slug: r.slug, name: r.name, lab_name: r.lab_name, access_via: r.access_via }));
	return { runs, signedIn: !!locals.user };
};
