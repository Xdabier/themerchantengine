import { BadRequestException } from '@nestjs/common';

/**
 * Checkout supplied an explicit shippingMethodId that is not among the rates
 * calculated for the destination (wrong zone, inactive, soft-deleted, or stale).
 * Previously `shippingRates.find(...)` returned undefined and the order pipeline
 * silently charged 0 shipping (orders.service.ts createOrder). Carries a stable
 * error code so the caller learns the method was rejected instead of getting a
 * free-shipping order.
 */
export class ShippingMethodInvalidException extends BadRequestException {
  static readonly CODE = 'SHIPPING_METHOD_INVALID' as const;

  constructor() {
    super({
      error: {
        code: ShippingMethodInvalidException.CODE,
        message: 'Selected shipping method is not valid for this destination',
      },
    });
  }
}
