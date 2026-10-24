import { NotFoundException } from '@nestjs/common';

/**
 * Storefront tried to submit a review or question, list reviews/questions, or
 * read the review summary for a product slug that does not resolve. The bare
 * `NotFoundException('Product "<slug>" not found')` at `reviews.service.ts`
 * `createReview` + `resolveProductBySlug` is replaced with this typed
 * exception so the storefront page catches the error by stable code instead of
 * status alone — see `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1
 * row #13.
 */
export class ReviewProductNotFoundException extends NotFoundException {
  static readonly CODE = 'REVIEW_PRODUCT_NOT_FOUND' as const;

  constructor(slug: string) {
    super({
      error: {
        code: ReviewProductNotFoundException.CODE,
        message: `Product "${slug}" not found`,
      },
    });
  }
}
