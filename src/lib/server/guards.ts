import { error } from '@sveltejs/kit';
import type { User } from '$lib/types';

/**
 * Throw a 401 if the request is not authenticated.
 * Use at the top of any API handler that mutates data.
 */
export function requireUser(locals: App.Locals): User {
	if (!locals.user) throw error(401, 'Authentication required');
	return locals.user;
}

/**
 * Throw a 403 if the request is not from an admin.
 * Use for settings, personnel, db snapshots, feedback management.
 */
export function requireAdmin(locals: App.Locals): User {
	const u = requireUser(locals);
	if (u.role !== 'admin') throw error(403, 'Admin role required');
	return u;
}

/**
 * Return the caller's lab_id or throw 403 if unset. Unset means a
 * GitHub-OAuth signup that was approved but not yet assigned to a lab — the
 * user is logged in but can't see or touch any lab-scoped data. Use this at
 * the top of any API handler that reads/writes lab-owned resources.
 *
 * Throws 401 if not authenticated (via requireUser).
 */
export function requireLab(locals: App.Locals): { user: User; labId: string } {
	const user = requireUser(locals);
	if (!user.lab_id) {
		throw error(403, 'Your account is not assigned to a lab. Ask an admin to assign you.');
	}
	return { user, labId: user.lab_id };
}

/**
 * Admin + lab-scoped — a user must be a lab-admin. There is no super-admin
 * role: every admin is scoped to their own lab and cannot see or touch
 * other labs' data.
 */
export function requireLabAdmin(locals: App.Locals): { user: User; labId: string } {
	const user = requireAdmin(locals);
	if (!user.lab_id) {
		throw error(403, 'Your account is not assigned to a lab.');
	}
	return { user, labId: user.lab_id };
}
