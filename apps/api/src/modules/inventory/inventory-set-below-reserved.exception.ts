import { BadRequestException } from '@nestjs/common';

/**
 * A set-to write would leave `onHand` below the quantity already reserved.
 *
 * Refused because `available` is computed as `onHand - reserved`, so allowing
 * it would make available negative and leave the admin and the storefront
 * disagreeing about a variant that has open reservations against it.
 */
export class InventorySetBelowReservedException extends BadRequestException {
  static readonly CODE = 'INVENTORY_SET_BELOW_RESERVED' as const;

  constructor(setTo: number, reserved: number) {
    super({
      error: {
        code: InventorySetBelowReservedException.CODE,
        message: `Cannot set stock to ${setTo}: ${reserved} unit(s) are already reserved`,
        details: { setTo, reserved },
      },
    });
  }
}
