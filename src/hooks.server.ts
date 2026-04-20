import type { Handle } from '@sveltejs/kit';
import { json, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { validateSession, maybeSweepExpired, isSecureOrigin } from '$lib/server/auth';

/**
 * Security headers applied to every response.
 *
 * NB: Content-Security-Policy is configured in `svelte.config.js` under
 * `kit.csp` rather than here — SvelteKit owns CSP because it needs to
 * compute sha256 hashes for the inline <script> blocks it emits for SSR
 * data injection and hydration bootstrap. Setting CSP from this hook
 * would block those scripts and break every page.
 *
 *   HSTS: only when ORIGIN is https. 180-day window is a conservative start.
 *   Referrer-Policy: strict-origin-when-cross-origin sends only the bare
 *     origin (no path) on cross-origin requests, never the full URL —
 *     same privacy floor as `same-origin` for path leakage, but still
 *     identifies us as a real origin to OSM tile servers (which block
 *     reqs that arrive with no Referer at all). Was `same-origin`; that
 *     stripped the Referer entirely on cross-origin and got the OSM
 *     "Blocked" tile served on every map view.
 *   X-Frame-Options: prevent clickjacking via iframe embedding.
 *   X-Content-Type-Options: stop MIME sniffing globally; the photo routes
 *     also set this explicitly as defense in depth.
 */
function applySecurityHeaders(response: Response) {
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'geolocation=(self), camera=(self)');
	if (isSecureOrigin()) {
		response.headers.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
	}
}

/**
 * Routes under /api/* that are reachable without authentication.
 * Anything not matched here requires a valid session for any HTTP method.
 *
 * KEEP THIS LIST SHORT. Adding routes here opens the public attack surface;
 * prefer wiring auth into the handler.
 */
const PUBLIC_API_ROUTES: Record<string, string[]> = {
	'/api/feedback': ['POST'] // anonymous lab users can submit feedback
	// /api/auth/setup-lab and /api/auth/join require an authenticated user
	// (just one without a lab_id) — they're gated by the lab-setup
	// allowlist below, NOT by being public.
};

function isPublicApi(pathname: string, method: string): boolean {
	const allowed = PUBLIC_API_ROUTES[pathname];
	return !!allowed && allowed.includes(method);
}

/**
 * Path prefixes whose mutating verbs require an admin role.
 * GET on these paths still works for any authenticated user (so the
 * Settings page can render dropdowns) — only writes are admin-gated.
 *
 * Picklists, primer sets, PCR protocols, naming templates, and personnel
 * are intentionally NOT here — regular users can edit those. The
 * admin-only items are user accounts, the DB-snapshot push, and the
 * feedback queue.
 */
const ADMIN_WRITE_PREFIXES = [
	'/api/users', // covers /api/users and /api/users/[id]/...
	'/api/db/',
	'/api/feedback/', // covers /api/feedback/[id] PUT/DELETE
	'/api/invites',   // covers /api/invites and /api/invites/[token]
	'/api/lab'        // covers /api/lab (DELETE the lab) + /api/lab/settings + /api/lab/settings/test
];

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function requiresAdmin(pathname: string, method: string): boolean {
	if (!MUTATING_METHODS.has(method)) {
		// GET /api/feedback is admin-only (list of all feedback)
		if (pathname === '/api/feedback' && method === 'GET') return true;
		// GET /api/users is admin-only (lists local + GitHub users)
		if (pathname === '/api/users' && method === 'GET') return true;
		// GET /api/invites is admin-only (active + used invites for the lab)
		if (pathname === '/api/invites' && method === 'GET') return true;
		// GET /api/lab/settings is admin-only (exposes whether token is set)
		if (pathname === '/api/lab/settings' && method === 'GET') return true;
		// GET /api/lab/settings/test exercises the configured GitHub token
		if (pathname === '/api/lab/settings/test' && method === 'GET') return true;
		// GET /api/db/snapshots lists this lab's backup history (admin-only)
		if (pathname === '/api/db/snapshots' && method === 'GET') return true;
		// GET /api/db/restore/commits lists pickable commits for restore
		if (pathname === '/api/db/restore/commits' && method === 'GET') return true;
		return false;
	}
	return ADMIN_WRITE_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Routes a viewer (read-only role) is allowed to mutate.
 * Everything else returns 403 for any POST/PUT/PATCH/DELETE.
 *
 * Viewers can still:
 *   - GET any resource they have access to
 *   - Change their own password (POST /api/account/password)
 *   - Submit feedback (POST /api/feedback)
 *   - Sign out (POST /auth/logout — handled outside the /api/ tree)
 */
const VIEWER_WRITE_ALLOWLIST = new Set(['/api/account/password', '/api/feedback']);

function blockedByViewerReadOnly(pathname: string, method: string, role: string | undefined): boolean {
	if (role !== 'viewer') return false;
	if (!MUTATING_METHODS.has(method)) return false;
	if (!pathname.startsWith('/api/')) return false;
	if (VIEWER_WRITE_ALLOWLIST.has(pathname)) return false;
	return true;
}

/**
 * Routes a user with must_change_password=1 is allowed to reach. Everything
 * else gets bounced to /auth/change-password until the flag clears.
 *
 * The change-password page itself, the API that submits the new password,
 * and the logout endpoint all need to be reachable so the user can
 * actually complete (or escape) the flow.
 */
const PASSWORD_CHANGE_ALLOWLIST = new Set([
	'/auth/change-password',
	'/auth/logout',
	'/api/account/password'
]);

function blockedByPasswordChange(pathname: string, user: { must_change_password: number } | null): boolean {
	if (!user || user.must_change_password !== 1) return false;
	if (PASSWORD_CHANGE_ALLOWLIST.has(pathname)) return false;
	// Allow SvelteKit's static asset routes through so the change-password
	// page itself can render its CSS / JS bundles.
	if (pathname.startsWith('/_app/') || pathname === '/favicon.ico') return false;
	return true;
}

/**
 * Routes a logged-in user with lab_id=NULL is allowed to reach. Everything
 * else gets bounced to /auth/setup-lab until they either create their own
 * lab or accept an invite. Mirrors the must_change_password gate above.
 *
 * /account and /api/account/* are explicitly allowed: account management
 * (avatar, password, self-delete) doesn't touch lab data, and a user
 * mid-onboarding shouldn't be locked out of deleting their own account
 * if they change their mind.
 */
const LAB_SETUP_ALLOWLIST = new Set([
	'/auth/setup-lab',
	'/auth/logout',
	'/api/auth/setup-lab',
	'/api/auth/join',
	'/account'
]);

function blockedByMissingLab(pathname: string, user: { lab_id: string | null } | null): boolean {
	if (!user || user.lab_id) return false;
	if (LAB_SETUP_ALLOWLIST.has(pathname)) return false;
	// Allow the join-via-token routes (path is /auth/join/<token>).
	if (pathname.startsWith('/auth/join/')) return false;
	// Allow self-account API endpoints (avatar, password, self-delete) so
	// a lab-less user can still manage / delete their own account.
	if (pathname === '/api/account' || pathname.startsWith('/api/account/')) return false;
	if (pathname.startsWith('/_app/') || pathname === '/favicon.ico') return false;
	return true;
}

/**
 * Public-page allowlist: HTML pages that don't require a session.
 * Everything else (the dashboard, projects, samples, settings, every CRUD
 * page) is gated behind a login — even SSR data is denied to anonymous
 * visitors.
 *
 * Note: /api/* routes are gated separately, above. Static asset paths
 * (/_app/, /favicon.ico) are also allowed unconditionally.
 */
const PUBLIC_PAGE_PREFIXES = [
	'/auth/' // login form, GitHub OAuth callback, pending, change-password
];

function isPublicPage(pathname: string): boolean {
	if (pathname.startsWith('/_app/')) return true;
	if (pathname === '/favicon.ico' || pathname === '/favicon.png') return true;
	if (pathname === '/privacy') return true;
	return PUBLIC_PAGE_PREFIXES.some((p) => pathname.startsWith(p));
}

export const handle: Handle = async ({ event, resolve }) => {
	// Initialize DB on first request
	getDb();

	// Periodic sweep of expired sessions + oauth states (rate-limited internally).
	maybeSweepExpired();

	// Session-based auth
	const sessionId = event.cookies.get('session');
	event.locals.user = sessionId ? validateSession(sessionId) : null;

	const { pathname } = event.url;
	const method = event.request.method;

	// Centralized API auth gate.
	if (pathname.startsWith('/api/')) {
		if (!event.locals.user && !isPublicApi(pathname, method)) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}
		if (requiresAdmin(pathname, method) && event.locals.user?.role !== 'admin') {
			return json({ error: 'Admin role required' }, { status: 403 });
		}
		if (blockedByViewerReadOnly(pathname, method, event.locals.user?.role)) {
			return json({ error: 'Viewer role is read-only' }, { status: 403 });
		}
	} else if (!isPublicPage(pathname)) {
		// Page-level gate: any non-/api, non-public page requires a session.
		// SvelteKit page loads run server-side and would otherwise serve DB
		// data to anonymous visitors via SSR.
		if (!event.locals.user) {
			const next = encodeURIComponent(pathname + event.url.search);
			throw redirect(302, `/auth/login?next=${next}`);
		}
	}

	// Password-change gate: a user with must_change_password=1 can't reach
	// any route except the change-password page, the password API, and
	// logout. This forces the seeded admin/admin (and any admin-created
	// account with a temporary password) to set a real password before
	// doing anything else.
	if (blockedByPasswordChange(pathname, event.locals.user)) {
		if (pathname.startsWith('/api/')) {
			return json({ error: 'Password change required' }, { status: 403 });
		}
		throw redirect(302, '/auth/change-password');
	}

	// Lab-setup gate: a logged-in user with lab_id=NULL (e.g. a brand-new
	// GitHub-OAuth signup) is forced to /auth/setup-lab where they choose
	// between starting a new lab and accepting an invite. They can reach
	// nothing else until lab membership is established.
	if (blockedByMissingLab(pathname, event.locals.user)) {
		if (pathname.startsWith('/api/')) {
			return json({ error: 'Lab setup required' }, { status: 403 });
		}
		throw redirect(302, '/auth/setup-lab');
	}

	const response = await resolve(event);
	applySecurityHeaders(response);
	return response;
};
