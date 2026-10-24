import { BadRequestException } from '@nestjs/common';

/**
 * Checkout (storefront or admin order-create) resolved zero shipping rates for
 * the destination even though the store has at least one active shipping zone.
 * Previously the order pipeline silently charged 0 shipping in this case
 * (orders.service.ts createOrder), which let an order ship for free whenever the
 * destination fell outside every configured zone. Carries a stable error code so
 * the checkout page can surface a localized "we don't ship there" message under
 * both locales.
 */
export class ShippingUnavailableException extends BadRequestException {
  static readonly CODE = 'SHIPPING_UNAVAILABLE' as const;

  constructor() {
    super({
      error: {
        code: ShippingUnavailableException.CODE,
        message: 'Shipping is not available for this destination',
      },
    });
  }
}
