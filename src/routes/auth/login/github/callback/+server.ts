import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGitHub, upsertGitHubUser, createSession, sessionCookieOptions } from '$lib/server/auth';
import { timingSafeEqual } from 'node:crypto';

function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

export const GET: RequestHandler = async ({ url, cookies }) => {
	const github = getGitHub();
	if (!github) throw error(500, 'GitHub OAuth not configured');

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');

	if (!code || !state) {
		throw error(400, 'Missing OAuth code or state');
	}

	// Strict cookie-bound state check. The state cookie is set on the same
	// browser that initiated the flow, so cross-browser code injection
	// (account-fixation) is blocked.
	const cookieState = cookies.get('github_oauth_state');
	if (!cookieState || !safeEqual(state, cookieState)) {
		throw error(400, 'Invalid OAuth state');
	}
	cookies.delete('github_oauth_state', { path: '/' });

	const tokens = await github.validateAuthorizationCode(code);
	const accessToken = tokens.accessToken();

	const res = await fetch('https://api.github.com/user', {
		headers: { Authorization: `Bearer ${accessToken}` }
	});
	if (!res.ok) throw error(500, 'Failed to fetch GitHub user');

	const githubUser = await res.json();
	const user = upsertGitHubUser({
		id: githubUser.id,
		login: githubUser.login,
		name: githubUser.name,
		email: githubUser.email,
		avatar_url: githubUser.avatar_url
	});

	const sessionId = createSession(user.id);
	cookies.set('session', sessionId, sessionCookieOptions());

	throw redirect(302, '/');
};
