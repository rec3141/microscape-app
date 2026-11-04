import type { PageServerLoad } from './$types';
import { listAccessibleRuns } from '$lib/server/run-list';

/** Landing page: every run the caller can see (see listAccessibleRuns). */
export const load: PageServerLoad = async ({ locals }) => {
	const runs = listAccessibleRuns(locals.user ?? null).map(({ data_path: _, ...r }) => r);
	return { runs, signedIn: !!locals.user };
};
