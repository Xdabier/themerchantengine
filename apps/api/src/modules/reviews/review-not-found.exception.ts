import { NotFoundException } from '@nestjs/common';

/**
 * Admin or storefront review lookup by id returned no row. Hot path —
 * 4 call sites across the reviews service (admin moderate, vote, report).
 */
export class ReviewNotFoundException extends NotFoundException {
  static readonly CODE = 'REVIEW_NOT_FOUND' as const;

  constructor(reviewId?: string) {
    super({
      error: {
        code: ReviewNotFoundException.CODE,
        message: reviewId ? `Review "${reviewId}" not found` : 'Review not found',
      },
    });
  }
}
