import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyLocalUser, createSession, sessionCookieOptions } from '$lib/server/auth';
import { checkRate } from '$lib/server/rate-limit';

/**
 * Validate a `?next=` redirect target. We only allow same-origin paths
 * starting with `/` and not `//` (which browsers parse as scheme-relative
 * URLs to other origins). This stops `?next=https://evil.example.com`
 * open-redirect attacks.
 */
function safeNext(raw: string | null): string {
	if (!raw) return '/';
	if (!raw.startsWith('/')) return '/';
	if (raw.startsWith('//')) return '/';
	return raw;
}

export const POST: RequestHandler = async ({ request, url, cookies, getClientAddress }) => {
	// Rate limit per IP: 5 attempts / minute
	const ip = getClientAddress();
	if (!checkRate(`login:${ip}`, 5, 60_000)) {
		throw redirect(302, '/auth/login?error=rate_limited');
	}

	const formData = await request.formData();
	const username = formData.get('username')?.toString()?.trim();
	const password = formData.get('password')?.toString();

	const next = safeNext(url.searchParams.get('next'));

	if (!username || !password) {
		throw redirect(302, '/auth/login?error=missing_credentials');
	}

	// NB: do NOT length-check the password here. Length validation belongs on
	// password SET (registration / change), not on VERIFY. The seeded
	// admin/admin bootstrap account uses a 5-char password and we still need
	// to be able to log in to it once before the must_change_password gate
	// forces a real password.
	const user = await verifyLocalUser(username, password);
	if (!user) {
		throw redirect(302, '/auth/login?error=invalid_credentials');
	}

	const sessionId = createSession(user.id);
	cookies.set('session', sessionId, sessionCookieOptions());

	// The hooks gate will redirect to /auth/change-password if must_change_password=1.
	throw redirect(302, next);
};
