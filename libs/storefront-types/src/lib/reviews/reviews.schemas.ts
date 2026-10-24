import * as z from 'zod';
import { ratingSummarySchema, reviewSchema } from '../shared/entities';
import { uuidV4Schema } from '../shared/ids';

/**
 * Storefront reviews schemas. Mirrors:
 * - `apps/api/src/modules/reviews/dto/create-review.dto.ts:CreateReviewDto`
 * - `apps/api/src/modules/reviews/dto/update-review.dto.ts:UpdateReviewDto`
 * - `apps/api/src/modules/reviews/dto/query-reviews.dto.ts:ListReviewsStorefrontDto`
 *
 * Review create/update mutate own reviews only via `@OwnerGuard()`. Asset ids
 * are UUID v4 per the backend `@IsUUID('4')` constraint.
 */

export const createReviewRequestSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().max(200).optional(),
  body: z.string().min(1).max(5000),
  assetIds: z.array(uuidV4Schema).optional(),
});
export type CreateReviewRequest = z.infer<typeof createReviewRequestSchema>;

export const updateReviewRequestSchema = createReviewRequestSchema.partial();
export type UpdateReviewRequest = z.infer<typeof updateReviewRequestSchema>;

export const listReviewsQuerySchema = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  sortBy: z.enum(['createdAt', 'helpfulCount', 'rating']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});
export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;

export const reviewSummaryResponseSchema = ratingSummarySchema;

/**
 * `GET /v1/products/:slug/reviews/eligibility`.
 *
 * Decided by the same service method as the write path, so a form gated on
 * one rule and a server refusing on another cannot happen. `ALREADY_REVIEWED`
 * is advisory: the unique `[productId, userId]` constraint still settles the
 * race on submit.
 */
export const reviewEligibilitySchema = z
  .object({
    eligible: z.boolean(),
    reason: z.enum(['VERIFIED_PURCHASE_REQUIRED', 'ALREADY_REVIEWED']).nullable(),
  })
  .passthrough();
export type ReviewEligibility = z.infer<typeof reviewEligibilitySchema>;

/**
 * Helpful-vote toggle response. The backend returns the boolean voted-state
 * for the caller (`{ helpful: true | false }`). Aggregate counts come from
 * `GET /v1/products/:slug/reviews` (and the question equivalent), so the
 * page refetches the list to render canonical counts after a toggle.
 */
export const helpfulVoteResponseSchema = z
  .object({
    helpful: z.boolean(),
  })
  .passthrough();

export { reviewSchema };
export type { Review, ReviewStatus } from '../shared/entities';
