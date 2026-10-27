import { Inject, Injectable } from '@angular/core';
import {
  apiResponseSchema,
  createReviewRequestSchema,
  helpfulVoteResponseSchema,
  listReviewsQuerySchema,
  paginationMetaSchema,
  reviewEligibilitySchema,
  reviewSchema,
  reviewSummaryResponseSchema,
  updateReviewRequestSchema,
  type CreateReviewRequest,
  type ListReviewsQuery,
  type PaginationMeta,
  type Review,
  type ReviewEligibility,
  type UpdateReviewRequest,
} from '@storefront-types';
import * as z from 'zod';
import { STOREFRONT_API_CLIENT, type ApiClient } from '../shared/api-client.token';

const paginatedReviewsEnvelopeSchema = apiResponseSchema(z.array(reviewSchema)).extend({
  meta: paginationMetaSchema,
});

@Injectable({ providedIn: 'root' })
export class ReviewsService {
  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  async list(
    productSlug: string,
    query: ListReviewsQuery = {},
  ): Promise<{
    data: Review[];
    meta: PaginationMeta;
  }> {
    z.string().min(1).parse(productSlug);
    const parsed = listReviewsQuerySchema.parse(query);
    const envelope = await this.api.get<unknown>(
      `/v1/products/${encodeURIComponent(productSlug)}/reviews`,
      { query: parsed as Record<string, string | number | undefined> },
    );
    const result = paginatedReviewsEnvelopeSchema.parse(envelope);
    return { data: result.data, meta: result.meta };
  }

  async create(productSlug: string, input: CreateReviewRequest): Promise<Review> {
    z.string().min(1).parse(productSlug);
    const body = createReviewRequestSchema.parse(input);
    const envelope = await this.api.post<unknown>(
      `/v1/products/${encodeURIComponent(productSlug)}/reviews`,
      body,
    );
    return apiResponseSchema(reviewSchema).parse(envelope).data;
  }

  /**
   * The caller's own review for a product, in any status, or null.
   *
   * The public list is PUBLISHED-only, so this is the only way to read back a
   * review that is still awaiting moderation. Authenticated callers only —
   * the page fetches it from an authed-flip effect, never on the SSR pass.
   */
  async mine(productSlug: string): Promise<Review | null> {
    z.string().min(1).parse(productSlug);
    const envelope = await this.api.get<unknown>(
      `/v1/products/${encodeURIComponent(productSlug)}/reviews/mine`,
    );
    return apiResponseSchema(reviewSchema.nullable()).parse(envelope).data;
  }

  /**
   * Whether the caller may review this product.
   *
   * The form used to be offered to every signed-in visitor and gated only by
   * the 400 the server answered after they had written the review.
   */
  async eligibility(productSlug: string): Promise<ReviewEligibility> {
    z.string().min(1).parse(productSlug);
    const envelope = await this.api.get<unknown>(
      `/v1/products/${encodeURIComponent(productSlug)}/reviews/eligibility`,
    );
    return apiResponseSchema(reviewEligibilitySchema).parse(envelope).data;
  }

  async summary(productSlug: string): Promise<z.infer<typeof reviewSummaryResponseSchema>> {
    z.string().min(1).parse(productSlug);
    const envelope = await this.api.get<unknown>(
      `/v1/products/${encodeURIComponent(productSlug)}/reviews/summary`,
    );
    return apiResponseSchema(reviewSummaryResponseSchema).parse(envelope).data;
  }

  async update(reviewId: string, input: UpdateReviewRequest): Promise<Review> {
    z.string().min(1).parse(reviewId);
    const body = updateReviewRequestSchema.parse(input);
    const envelope = await this.api.patch<unknown>(
      `/v1/reviews/${encodeURIComponent(reviewId)}`,
      body,
    );
    return apiResponseSchema(reviewSchema).parse(envelope).data;
  }

  async delete(reviewId: string): Promise<void> {
    z.string().min(1).parse(reviewId);
    await this.api.delete<unknown>(`/v1/reviews/${encodeURIComponent(reviewId)}`);
  }

  async toggleHelpful(reviewId: string): Promise<z.infer<typeof helpfulVoteResponseSchema>> {
    z.string().min(1).parse(reviewId);
    const envelope = await this.api.post<unknown>(
      `/v1/reviews/${encodeURIComponent(reviewId)}/helpful`,
    );
    return apiResponseSchema(helpfulVoteResponseSchema).parse(envelope).data;
  }
}
