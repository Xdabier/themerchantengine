import { BadRequestException } from '@nestjs/common';

/**
 * Storefront tried to submit a review on a product the customer never
 * received in a DELIVERED order. The constitution mandates verified
 * purchase before review submission (`merchants-engine-technical-spec-v2.2`
 * §06 reviews). This exception carries a stable error code so the storefront
 * can map it to a localized message in EN + AR — see
 * `specs/features/storefront-e2e-hardening/plan.md` §5 B1 for the root cause
 * (the catch-all swallowing the generic `BadRequestException` message).
 */
export class ReviewVerifiedPurchaseRequiredException extends BadRequestException {
  static readonly CODE = 'REVIEW_VERIFIED_PURCHASE_REQUIRED' as const;

  constructor() {
    super({
      error: {
        code: ReviewVerifiedPurchaseRequiredException.CODE,
        message: 'A verified purchase is required to leave a review',
      },
    });
  }
}
