import { BadRequestException } from '@nestjs/common';

/**
 * An admin tried to issue a card in a currency the store does not accept.
 * The currency is not free text: it must be one of the enabled currencies
 * from `/v1/admin/currencies`.
 */
export class GiftCardCurrencyNotEnabledException extends BadRequestException {
  static readonly CODE = 'GIFT_CARD_CURRENCY_NOT_ENABLED' as const;

  constructor(currency: string, enabled: readonly string[]) {
    super({
      error: {
        code: GiftCardCurrencyNotEnabledException.CODE,
        message: `Currency "${currency}" is not enabled for this store`,
        details: { enabled },
      },
    });
  }
}
