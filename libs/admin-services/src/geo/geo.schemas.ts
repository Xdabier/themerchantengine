import { z } from 'zod';
import { entityIdSchema, translatableSchema } from '@admin-types';

export const aiReadinessSignalsSchema = z.object({
  answerFirstDescription: z.number().min(0).max(1),
  faqEntries: z.number().min(0).max(1),
  completeSchemaMarkup: z.number().min(0).max(1),
});
export type AiReadinessSignals = z.infer<typeof aiReadinessSignalsSchema>;

export const aiReadinessReportSchema = z.object({
  score: z.number().min(0).max(100),
  signals: aiReadinessSignalsSchema,
  productsAnalyzed: z.number().int().nonnegative().optional(),
});
export type AiReadinessReport = z.infer<typeof aiReadinessReportSchema>;

export const faqItemSchema = z.object({
  question: translatableSchema,
  answer: translatableSchema,
  sortOrder: z.number().int().nonnegative().optional(),
});
export type FaqItem = z.infer<typeof faqItemSchema>;

export const faqSuggestionsResponseSchema = z.object({
  data: z.array(faqItemSchema),
});
export type FaqSuggestionsResponse = z.infer<typeof faqSuggestionsResponseSchema>;

export const acceptFaqsRequestSchema = z.object({
  faqs: z.array(faqItemSchema).min(1),
});
export type AcceptFaqsRequest = z.infer<typeof acceptFaqsRequestSchema>;

export const productFaqSchema = z.object({
  id: entityIdSchema,
  productId: entityIdSchema,
  question: translatableSchema,
  answer: translatableSchema,
  sortOrder: z.number().int().nonnegative(),
  createdAt: z.string().datetime().optional(),
});
export type ProductFaq = z.infer<typeof productFaqSchema>;

export const acceptFaqsResponseSchema = z.object({
  data: z.array(productFaqSchema),
});
export type AcceptFaqsResponse = z.infer<typeof acceptFaqsResponseSchema>;
