import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Setup-lab is reachable for any signed-in user. New signups (no lab)
 * are forced here by the hooks gate; existing users can reach it via the
 * lab-switcher "+ New lab" option to create additional labs.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/auth/login?next=' + encodeURIComponent('/auth/setup-lab'));
	}
	return {};
};
