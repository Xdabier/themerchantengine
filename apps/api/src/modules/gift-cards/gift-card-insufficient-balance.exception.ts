import { BadRequestException } from '@nestjs/common';

/**
 * Redeem or adjust amount would push gift-card balance negative.
 */
export class GiftCardInsufficientBalanceException extends BadRequestException {
  static readonly CODE = 'GIFT_CARD_INSUFFICIENT_BALANCE' as const;

  constructor(message = 'Insufficient gift card balance') {
    super({ error: { code: GiftCardInsufficientBalanceException.CODE, message } });
  }
}
