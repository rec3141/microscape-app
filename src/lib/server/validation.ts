import { json } from '@sveltejs/kit';
import type { ZodError, ZodType, z } from 'zod';

/**
 * Run a request body through a zod schema and return either the validated
 * data or a 400 JSON response that's safe to send to the client.
 *
 * Usage:
 *
 *     const parsed = parseBody(UserCreateBody, await request.json());
 *     if (!parsed.ok) return parsed.response;
 *     const data = parsed.data; // fully typed
 *
 * The error response includes per-field issue messages so the client can
 * surface them inline. zod's default messages are safe — they describe the
 * validation rule, not the database internals.
 */
export function parseBody<T extends ZodType>(
	schema: T,
	body: unknown
): { ok: true; data: z.infer<T> } | { ok: false; response: Response } {
	const result = schema.safeParse(body);
	if (result.success) return { ok: true, data: result.data };
	return {
		ok: false,
		response: json(
			{
				error: 'Validation failed',
				issues: formatZodIssues(result.error)
			},
			{ status: 400 }
		)
	};
}

function formatZodIssues(error: ZodError): { path: string; message: string }[] {
	return error.issues.map((i) => ({
		path: i.path.join('.'),
		message: i.message
	}));
}
