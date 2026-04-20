import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGitHub, isSecureOrigin } from '$lib/server/auth';
import { generateState } from 'arctic';

export const GET: RequestHandler = async ({ cookies }) => {
	const github = getGitHub();
	if (!github) {
		throw redirect(302, '/auth/login?error=github_not_configured');
	}

	const state = generateState();
	const url = github.createAuthorizationURL(state, ['user:email']);

	// State is bound to the user's browser via an httpOnly cookie.
	// SameSite=lax works for OAuth because the GitHub redirect back is a
	// top-level GET; lax cookies are sent on top-level navigations.
	cookies.set('github_oauth_state', state, {
		path: '/',
		httpOnly: true,
		secure: isSecureOrigin(),
		maxAge: 600,
		sameSite: 'lax'
	});

	throw redirect(302, url.toString());
};
