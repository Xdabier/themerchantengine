import { BadRequestException } from '@nestjs/common';

/**
 * Checkout named a payment method the operator does not offer, or named none
 * while the operator offers several.
 *
 * The enabled set is read at create time rather than trusted from the client:
 * a method disabled between page load and submit must not still take an order,
 * and a `stripe`-provider row half-configured in admin must not produce an
 * order nobody can charge (the public projection filters providers, so such a
 * code never appears in the enabled set here either).
 */
export class OrderPaymentMethodInvalidException extends BadRequestException {
  static readonly CODE = 'ORDER_PAYMENT_METHOD_INVALID' as const;

  constructor(message = 'Selected payment method is not available') {
    super({
      error: { code: OrderPaymentMethodInvalidException.CODE, message },
    });
  }
}
