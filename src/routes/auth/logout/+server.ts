import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSession } from '$lib/server/auth';

// POST only — using GET would let any cross-origin <img> tag force a logout.
export const POST: RequestHandler = async ({ cookies }) => {
	const sessionId = cookies.get('session');
	if (sessionId) {
		deleteSession(sessionId);
		cookies.delete('session', { path: '/' });
	}
	throw redirect(302, '/');
};
