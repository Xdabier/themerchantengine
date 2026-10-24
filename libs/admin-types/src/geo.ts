import { z } from 'zod';

/**
 * Sibling Zod schemas for `POST /v1/admin/geo/faq-suggestions/accept`. Mirror
 * the backend class-validator DTOs at
 * `apps/api/src/modules/geo/dto/accept-faq-suggestions.dto.ts:4-24` so the
 * admin client can parse / validate the wire shape without re-importing
 * backend types. The `question` + `answer` fields are Translatable objects
 * (keyed by locale code → message string) per constitution §3.2.
 */
export const faqItemSchema = z.object({
  question: z.record(z.string(), z.string()),
  answer: z.record(z.string(), z.string()),
  sortOrder: z.number().int().min(0).optional(),
});

export type FaqItemInput = z.infer<typeof faqItemSchema>;

export const acceptFaqSuggestionsSchema = z.object({
  faqs: z.array(faqItemSchema),
});

export type AcceptFaqSuggestionsInput = z.infer<typeof acceptFaqSuggestionsSchema>;
