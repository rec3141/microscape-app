import { z } from 'zod';

const boolish = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));

export const ApiKeyCreateBody = z.object({
	name: z.string().trim().min(1).max(100),
	can_publish_public: boolish.default(0)
});

export const ApiKeyUpdateBody = z.object({
	can_publish_public: boolish
});
