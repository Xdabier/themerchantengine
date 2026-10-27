import { BadRequestException } from '@nestjs/common';

/**
 * Redeem or adjust amount is non-positive (redeem) or zero (adjust).
 */
export class GiftCardAmountInvalidException extends BadRequestException {
  static readonly CODE = 'GIFT_CARD_AMOUNT_INVALID' as const;

  constructor(message = 'Gift card amount is invalid') {
    super({ error: { code: GiftCardAmountInvalidException.CODE, message } });
  }
}
