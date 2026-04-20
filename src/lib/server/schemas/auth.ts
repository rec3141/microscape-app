import { z } from 'zod';

/**
 * Request body schemas for auth-adjacent endpoints. These are the most
 * security-sensitive routes in the app — input validation here is the first
 * line of defense, ahead of the SQLite CHECK constraints.
 */

const VALID_ROLES = ['admin', 'user', 'viewer'] as const;
const roleEnum = z.enum(VALID_ROLES);

const SHORT_TEXT = z.string().max(200);

// Convert empty strings to null so the DB column stays NULL rather than ''.
const optionalShortText = z
	.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), SHORT_TEXT.nullable().optional());

// Accept either a boolean or 0/1 number for "is X" fields, normalize to 0/1.
const boolish = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));

// ============================================================================
// /api/users
// ============================================================================

export const UserCreateBody = z.object({
	username: z.string().trim().min(1).max(64),
	password: z.string().min(10).max(128),
	role: roleEnum.default('user'),
	display_name: optionalShortText,
	email: optionalShortText
});

export const UserUpdateBody = z.object({
	role: roleEnum.optional(),
	is_approved: boolish.optional(),
	display_name: optionalShortText,
	email: optionalShortText,
	// Admin-only: assign / reassign a user to a lab. Validated as a 32-char
	// hex id; a null value explicitly unsets lab membership.
	lab_id: z.preprocess(
		(v) => (typeof v === 'string' && v.trim() === '' ? null : v),
		z.string().length(32).nullable().optional()
	)
});

export const ResetPasswordBody = z.object({
	password: z.string().min(10).max(128)
});

// ============================================================================
// /api/account/password
// ============================================================================

export const ChangeOwnPasswordBody = z.object({
	// Min length isn't enforced on the OLD password — it might be the 5-char
	// `admin` bootstrap password that we still need to accept. The new
	// password is policy-checked.
	old_password: z.string().min(1).max(128),
	new_password: z.string().min(10).max(128)
});
