import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { existsSync } from 'fs';
import { join } from 'path';
import { listAccessibleRuns } from '$lib/server/run-list';
import { datasetBySlug } from '$lib/earthdna/datasets';

/**
 * One EarthDNA reference globe (src/lib/earthdna/datasets.ts). On the globe
 * amplicon runs are placed against (SILVA), also every run the caller can see
 * whose PLACE_GLOBE step wrote data/globe.json(.gz). The page fetches each
 * run's files through the gated /runs/<id>/files/ route, so access is checked
 * again per file.
 */
export const load: PageServerLoad = async ({ locals, params }) => {
	const dataset = datasetBySlug(params.dataset);
	if (!dataset) error(404, 'No such EarthDNA globe');
	const runs = dataset.release
		? listAccessibleRuns(locals.user ?? null)
				.filter((r) => ['globe.json.gz', 'globe.json'].some((f) => existsSync(join(r.data_path, 'data', f))))
				.map((r) => ({ id: r.id, slug: r.slug, name: r.name, lab_name: r.lab_name, access_via: r.access_via }))
		: [];
	return { dataset, runs, signedIn: !!locals.user };
};
