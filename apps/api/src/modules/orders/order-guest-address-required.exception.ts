import { BadRequestException } from '@nestjs/common';

/**
 * An anonymous order arrived without an inline shipping address.
 *
 * A guest has no saved addresses, so `shippingAddressId` cannot resolve to
 * anything they own. Left unchecked, `resolveAddress` would fall through its
 * `addressId && userId` branch and return the empty default, and the order
 * would be created against an address nobody supplied. Refusing here keeps
 * that impossible.
 */
export class OrderGuestAddressRequiredException extends BadRequestException {
  static readonly CODE = 'ORDER_GUEST_ADDRESS_REQUIRED' as const;

  constructor() {
    super({
      error: {
        code: OrderGuestAddressRequiredException.CODE,
        message: 'A shipping address is required to check out as a guest',
      },
    });
  }
}
