import { z } from 'zod';
import {
  entityIdSchema,
  paginationMetaSchema,
  productQuestionSchema,
  reviewSchema as reviewEntitySchema,
  translatableNullableSchema,
} from '@admin-types';

/** Mirrors of Prisma `ReviewStatus` + `QuestionStatus`. */
export const reviewStatusSchema = z.enum(['PENDING', 'PUBLISHED', 'HIDDEN']);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const questionStatusSchema = z.enum(['PENDING', 'PUBLISHED', 'HIDDEN']);
export type QuestionStatus = z.infer<typeof questionStatusSchema>;

const embeddedUserSchema = z
  .object({
    id: entityIdSchema,
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const embeddedProductSchema = z
  .object({
    id: entityIdSchema,
    slug: z.string(),
  })
  .nullable()
  .optional();

/**
 * Admin response shape for `/v1/admin/reviews` (list + detail + mutation
 * responses). The admin client sends `X-Resolve-Locale: false`, so the backend
 * returns the raw Translatable JSONB for `title` / `body` — never a resolved
 * string. We compose the canonical entity schema from `@admin-types` so the
 * Translatable fields are single-sourced (constitution §3.14 / DR-21) and field
 * drift from the backend contract is structurally impossible. The local embeds
 * (`user` / `product` / `assets`) and the relaxed optionality that mutation
 * responses rely on are grafted on via `.extend()`.
 *
 * Inherited from the canonical schema: `body` (required Translatable), `rating`,
 * `status`, `createdAt`.
 */
export const reviewSchema = reviewEntitySchema.extend({
  // Keep the cuid/uuid-aware id validator the admin layer has always used.
  id: entityIdSchema,
  productId: entityIdSchema,
  userId: entityIdSchema.nullable().optional(),
  // `title` stays nullable + optional so mutation responses that omit it still
  // parse; the Translatable *type* is single-sourced from @admin-types.
  title: translatableNullableSchema.optional(),
  locale: z.string().nullable().optional(),
  verifiedPurchase: z.boolean().optional(),
  helpfulCount: z.number().int().nonnegative().optional(),
  updatedAt: z.string().datetime().optional(),
  assets: z.array(z.unknown()).optional(),
  user: embeddedUserSchema,
  product: embeddedProductSchema,
});
export type Review = z.infer<typeof reviewSchema>;

/**
 * Admin response shape for `/v1/admin/questions`. Same contract as reviews:
 * `question` / `answer` arrive as raw Translatable objects under
 * `X-Resolve-Locale: false`. Composed from the canonical `productQuestionSchema`
 * so `question` (required Translatable), `status`, and `createdAt` are inherited.
 */
export const questionSchema = productQuestionSchema.extend({
  id: entityIdSchema,
  productId: entityIdSchema,
  askedById: entityIdSchema.nullable().optional(),
  questionLocale: z.string().nullable().optional(),
  // `answer` stays nullable + optional for mutation responses; Translatable type
  // is single-sourced from @admin-types.
  answer: translatableNullableSchema.optional(),
  answeredBy: entityIdSchema.nullable().optional(),
  isAdminAnswer: z.boolean().optional(),
  helpfulCount: z.number().int().nonnegative().optional(),
  updatedAt: z.string().datetime().optional(),
  asker: embeddedUserSchema,
  product: embeddedProductSchema,
});
export type Question = z.infer<typeof questionSchema>;

export const listReviewsQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  status: reviewStatusSchema.optional(),
  productId: entityIdSchema.optional(),
  userId: entityIdSchema.optional(),
  rating: z.number().int().min(1).max(5).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'rating', 'helpfulCount']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});
export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;

export const listQuestionsQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  status: questionStatusSchema.optional(),
  productId: entityIdSchema.optional(),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'helpfulCount']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});
export type ListQuestionsQuery = z.infer<typeof listQuestionsQuerySchema>;

export const listReviewsResponseSchema = z.object({
  data: z.array(reviewSchema),
  meta: paginationMetaSchema,
});
export type ListReviewsResponse = z.infer<typeof listReviewsResponseSchema>;

export const listQuestionsResponseSchema = z.object({
  data: z.array(questionSchema),
  meta: paginationMetaSchema,
});
export type ListQuestionsResponse = z.infer<typeof listQuestionsResponseSchema>;

export const moderateRequestSchema = z.object({
  reason: z.string().max(1000).optional(),
});
export type ModerateRequest = z.infer<typeof moderateRequestSchema>;

// Write paths are intentionally scalar `string`, NOT Translatable: the backend
// DTOs (AdminUpdateReviewDto / AnswerQuestionAdminDto) accept a string and wrap
// it into the `{ default, [wrapKey] }` JSONB server-side. Do not "upgrade" these
// to translatableSchema — the response schemas above are the Translatable side.
export const adminUpdateReviewRequestSchema = z
  .object({
    rating: z.number().int().min(1).max(5).optional(),
    title: z.string().max(200).nullable().optional(),
    body: z.string().max(5000).optional(),
    status: reviewStatusSchema.optional(),
    assetIds: z.array(entityIdSchema).optional(),
    reason: z.string().max(1000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required.',
  });
export type AdminUpdateReviewRequest = z.infer<typeof adminUpdateReviewRequestSchema>;

export const answerQuestionRequestSchema = z.object({
  answer: z.string().min(1).max(5000),
  isAdminAnswer: z.boolean().optional(),
});
export type AnswerQuestionRequest = z.infer<typeof answerQuestionRequestSchema>;
