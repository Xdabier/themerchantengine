import { ForbiddenException } from '@nestjs/common';

/**
 * An anonymous visitor tried to place an order while the operator has guest
 * checkout switched off.
 *
 * `guestCheckoutEnabled` defaults to true when the setting has never been
 * written (`checkout.service.ts`), so this is the deliberate-off case rather
 * than an unconfigured store. Checked before the cart is read, so the refusal
 * is the same whatever state the visitor's basket is in.
 *
 * Forbidden rather than Unauthorized: signing in is not the remedy the
 * customer needs to be told about here, the store simply does not offer this.
 * The storefront maps the code to a localized message and offers sign-in as a
 * route forward.
 */
export class OrderGuestCheckoutDisabledException extends ForbiddenException {
  static readonly CODE = 'ORDER_GUEST_CHECKOUT_DISABLED' as const;

  constructor() {
    super({
      error: {
        code: OrderGuestCheckoutDisabledException.CODE,
        message: 'Guest checkout is not available',
      },
    });
  }
}
