import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** /runs is an alias for the landing page, which already lists every run
 *  the caller has access to. The navbar links here; without this file
 *  the bare /runs URL 404s (the only nested route is /runs/[id]). */
export const load: PageServerLoad = () => {
	throw redirect(302, '/');
};
