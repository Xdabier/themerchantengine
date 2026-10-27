import { BadRequestException } from '@nestjs/common';

/**
 * Storefront submitted a gift card code that failed validation. The three
 * underlying failure modes at `gift-cards.service.ts:60-65` —
 * not-found / soft-deleted-or-inactive / expired — collapse into this single
 * code by design: the §8.1 API6 enumeration-mask spec mandates that the wire
 * response never leaks which reason a gift card was rejected. The bare
 * `BadRequestException('Invalid or expired gift card')` previously thrown is
 * replaced with this typed exception so the storefront page can catch by
 * stable code instead of by status — see
 * `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 row #17.
 */
export class GiftCardInvalidException extends BadRequestException {
  static readonly CODE = 'GIFT_CARD_INVALID' as const;

  constructor() {
    super({
      error: {
        code: GiftCardInvalidException.CODE,
        message: 'Invalid or expired gift card',
      },
    });
  }
}
