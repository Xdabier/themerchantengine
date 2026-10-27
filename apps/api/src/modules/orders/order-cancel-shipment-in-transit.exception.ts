import { ConflictException } from '@nestjs/common';

/**
 * An admin tried to cancel an order whose goods have already left (finding
 * AD4). At least one shipment is SHIPPED or DELIVERED, so cancelling would
 * restore stock the warehouse no longer holds and leave a parcel in transit
 * against a cancelled order.
 *
 * The return flow owns this case: take the goods back, then close the order as
 * RETURNED. Thrown before the stock restore runs, so a refused cancel leaves
 * inventory untouched.
 */
export class OrderCancelShipmentInTransitException extends ConflictException {
  static readonly CODE = 'ORDER_CANCEL_SHIPMENT_IN_TRANSIT' as const;

  constructor() {
    super({
      error: {
        code: OrderCancelShipmentInTransitException.CODE,
        message:
          'This order has a shipment in transit and cannot be cancelled. Use the return flow instead.',
      },
    });
  }
}
