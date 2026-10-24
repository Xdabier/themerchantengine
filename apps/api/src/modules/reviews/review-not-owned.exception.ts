import { ForbiddenException } from '@nestjs/common';

/**
 * Storefront tried to edit or delete a review owned by a different customer.
 * The bare `ForbiddenException('Not your review')` at `reviews.service.ts`
 * `updateReview` + `deleteReview` is replaced with this typed exception so
 * the storefront page catches the error by stable code instead of a generic
 * 403 toast — see `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1
 * row #15.
 */
export class ReviewNotOwnedException extends ForbiddenException {
  static readonly CODE = 'REVIEW_NOT_OWNED' as const;

  constructor() {
    super({
      error: {
        code: ReviewNotOwnedException.CODE,
        message: 'Not your review',
      },
    });
  }
}
