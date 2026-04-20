import { json } from '@sveltejs/kit';
import { error as svelteKitError } from '@sveltejs/kit';

/**
 * Convert a thrown DB or validation error into a safe JSON response.
 *
 * Logs the raw error server-side for debugging, but only returns a generic
 * category to the client so SQLite constraint names, schema details, and
 * internal stack traces don't leak.
 *
 * Re-throws SvelteKit `error()` HttpError objects unchanged so 401/403 from
 * auth guards still flow correctly.
 */
export function apiError(err: unknown, fallbackStatus = 400) {
	// Re-throw SvelteKit HttpError so guards (401/403) propagate untouched.
	if (err && typeof err === 'object' && 'status' in err && 'body' in err) {
		throw err;
	}

	const raw = err instanceof Error ? err.message : String(err);
	console.error('[api-error]', raw);

	// Map common SQLite constraint failures to safe categories.
	let status = fallbackStatus;
	let message = 'Request failed';

	if (/UNIQUE constraint failed/i.test(raw)) {
		status = 409;
		message = 'A record with that identifier already exists';
	} else if (/CHECK constraint failed/i.test(raw)) {
		status = 400;
		message = 'One or more values are not allowed by the schema';
	} else if (/NOT NULL constraint failed/i.test(raw)) {
		status = 400;
		message = 'A required field is missing';
	} else if (/FOREIGN KEY constraint failed/i.test(raw)) {
		status = 400;
		message = 'Referenced record does not exist';
	}

	return json({ error: message }, { status });
}

/** Throw a 400 with a safe, hand-written message. */
export function badRequest(message: string): never {
	throw svelteKitError(400, message);
}
