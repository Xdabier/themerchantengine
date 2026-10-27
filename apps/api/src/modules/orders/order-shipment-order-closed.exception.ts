import { ConflictException } from '@nestjs/common';

/** Why a shipment write was refused. */
export type ShipmentClosedReason =
  | 'ORDER_CLOSED'
  | 'SHIPMENT_CANCELLED'
  | 'CANCEL_THE_ORDER_INSTEAD';

const MESSAGES: Record<ShipmentClosedReason, (status: string) => string> = {
  SHIPMENT_CANCELLED: () => 'This shipment was cancelled and can no longer change status',
  CANCEL_THE_ORDER_INSTEAD: () =>
    'A shipment cannot be cancelled on its own. Cancel the order, which cancels its shipments and restores the stock.',
  ORDER_CLOSED: (status) => `Order in ${status} status can no longer accept shipment changes`,
};

/**
 * An admin tried to create or update a shipment that can no longer move
 * (finding AD4).
 *
 * Three shapes of the same rule. `ORDER_CLOSED`: the order reached CANCELLED,
 * COMPLETED or RETURNED, so fulfilment is over and a new parcel or a status
 * bump would contradict the order. `SHIPMENT_CANCELLED`: the order is still
 * open but this particular row was cancelled by the cancel cascade, and a
 * cancelled shipment is terminal. `CANCEL_THE_ORDER_INSTEAD`: someone tried to
 * cancel a live shipment on its own, which would strand it terminal while its
 * order stayed open and its stock stayed decremented; cancelling the order is
 * the operation that does all three.
 *
 * 409 rather than 400: the request is well formed, the resource state is what
 * refuses it. The admin panel also hides these controls, so reaching this is
 * either a stale tab or a direct API call.
 */
export class OrderShipmentOrderClosedException extends ConflictException {
  static readonly CODE = 'ORDER_SHIPMENT_ORDER_CLOSED' as const;

  constructor(reason: ShipmentClosedReason, status: string) {
    super({
      error: {
        code: OrderShipmentOrderClosedException.CODE,
        message: MESSAGES[reason](status),
        details: { reason, status },
      },
    });
  }
}
