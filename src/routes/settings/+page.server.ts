import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Login required');
	if (locals.user.role !== 'admin') throw error(403, 'Admin role required');
	return {};
};
