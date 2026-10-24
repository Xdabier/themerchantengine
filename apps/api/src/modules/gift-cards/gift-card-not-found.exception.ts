import { NotFoundException } from '@nestjs/common';

/**
 * Admin-tier lookup by id returned no row. Distinct from B2's
 * storefront-tier `GIFT_CARD_INVALID` (anti-enumeration §8.1) — admin
 * paths preserve the not-found distinction because admins need to
 * differentiate "card doesn't exist" from "card exists but inactive".
 */
export class GiftCardNotFoundException extends NotFoundException {
  static readonly CODE = 'GIFT_CARD_NOT_FOUND' as const;

  constructor(id: string) {
    super({
      error: {
        code: GiftCardNotFoundException.CODE,
        message: `Gift card "${id}" not found`,
      },
    });
  }
}
