import { z } from 'zod';

/**
 * Request body schemas for /api/runs and /api/runs/[id]/access.
 *
 * Kept narrow on purpose — run.lab_id is set from the caller's active lab,
 * never from the request body, so there's no field for it here.
 */

const SHORT_TEXT = z.string().trim().max(200);
const LONG_TEXT = z.string().max(10_000);
// run_access grants are read-only by design (the lab-admin keeps edit rights
// via lab_memberships.role). The column still allows the wider set for
// historical rows; new grants always land as 'viewer'.
const GRANT_ROLE = z.literal('viewer');

// Convert empty strings to null so nullable columns stay NULL rather than ''.
const optionalLongText = z.preprocess(
	(v) => (typeof v === 'string' && v.trim() === '' ? null : v),
	LONG_TEXT.nullable().optional()
);

export const VISIBILITY = z.enum(['private', 'shared', 'public']);
export type Visibility = z.infer<typeof VISIBILITY>;

// Slugs are URL-safe run identifiers. Lowercase, alnum + dashes, 1..64 chars.
// A run's slug doubles as a top-level path segment (so `/chesterfield/` works
// as an alias for `/runs/<id>/files/`), which means slugs must not collide
// with any top-level route or static asset path the app owns.
const RESERVED_SLUGS = new Set([
	'settings', 'auth', 'api', 'runs', 'account', 'privacy', 'admin',
	'_app', '_protected', 'favicon.ico', 'favicon.png', 'manifest.json',
	'robots.txt'
]);

const slug = z
	.string()
	.trim()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9][a-z0-9_-]*$/, 'slug must be lowercase alnum with optional dashes or underscores')
	.refine((s) => !RESERVED_SLUGS.has(s), 'slug collides with a reserved path');

// Absolute host-filesystem path. Must start with '/' and must NOT contain
// relative segments — the gated file endpoint joins user-supplied subpaths
// against data_path and relies on it being canonical.
const absolutePath = z
	.string()
	.trim()
	.min(1)
	.max(1000)
	.regex(/^\//, 'data_path must be absolute')
	.refine((p) => !p.split('/').includes('..'), 'data_path may not contain "..');

export const RunCreateBody = z.object({
	pipeline_id: z.string().length(32),
	slug,
	name: SHORT_TEXT.min(1),
	description: optionalLongText,
	data_path: absolutePath,
	visibility: VISIBILITY.default('private')
});

// PATCH body for /api/runs/[id]. Visibility is one knob: private / shared /
// public. None of these move the run between labs — anonymous web access
// is now a property of the run itself, not its owning lab.
export const RunUpdateBody = z.object({
	slug: slug.optional(),
	name: SHORT_TEXT.min(1).optional(),
	description: optionalLongText,
	data_path: absolutePath.optional(),
	visibility: VISIBILITY.optional()
});

export const RunAccessGrantBody = z.object({
	user_id: z.string().length(32),
	role: GRANT_ROLE.default('viewer')
});
