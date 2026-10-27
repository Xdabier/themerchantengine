import { BadRequestException } from '@nestjs/common';

/**
 * Adjust-balance or email-recipient attempted on a deactivated card.
 */
export class GiftCardDeactivatedException extends BadRequestException {
  static readonly CODE = 'GIFT_CARD_DEACTIVATED' as const;

  constructor(message = 'Cannot perform this action on a deactivated gift card') {
    super({ error: { code: GiftCardDeactivatedException.CODE, message } });
  }
}
