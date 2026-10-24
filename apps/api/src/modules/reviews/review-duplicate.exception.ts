import { ConflictException } from '@nestjs/common';

/**
 * Storefront tried to submit a second review on a product the customer has
 * already reviewed. The Prisma unique constraint `[productId, userId]` on
 * `Review` catches the duplicate at insert time (`reviews.service.ts`
 * createReview catch block). This exception carries a stable error code so
 * the storefront can map it to a localized message in EN + AR — see
 * `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 row #1.
 */
export class ReviewDuplicateException extends ConflictException {
  static readonly CODE = 'REVIEW_DUPLICATE' as const;

  constructor() {
    super({
      error: {
        code: ReviewDuplicateException.CODE,
        message: 'You have already submitted a review for this product',
      },
    });
  }
}
