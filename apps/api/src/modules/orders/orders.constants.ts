import { OrderStatus } from '@prisma/client';

// ── Sequence prefixes ────────────────────────────────────────────────────────

export const ORDER_NUMBER_PREFIX = 'ORD';
export const INVOICE_NUMBER_PREFIX = 'INV';

// ── Status transition map ────────────────────────────────────────────────────

/**
 * Allowed transitions from each status (§4.8).
 *
 * Mirrored client-side by `ORDER_STATUS_TRANSITIONS` in
 * `apps/admin/src/app/features/orders/orders.utils.ts`, which drives which
 * actions the admin offers. Change this map and that mirror together; the
 * admin unit spec pins the literal and fails naming both files.
 */
export const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  CONFIRMED: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  PROCESSING: [OrderStatus.ON_HOLD, OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  ON_HOLD: [OrderStatus.PROCESSING],
  SHIPPED: [OrderStatus.DELIVERED],
  // H-1: DELIVERED can now transition to RETURNED (terminal) when return is closed (§4.8)
  DELIVERED: [OrderStatus.COMPLETED, OrderStatus.RETURNED],
  COMPLETED: [],
  CANCELLED: [],
  // RETURN_REQUESTED is kept for backward compatibility but is no longer used in new flows
  RETURN_REQUESTED: [],
  // H-1: RETURNED is the spec-correct terminal state after a return is fully closed (§4.8)
  RETURNED: [],
};

/**
 * Statuses that allow pre-fulfillment editing (§4.8). Mirrored client-side by
 * `EDITABLE_ORDER_STATUSES` in `apps/admin/.../orders/orders.utils.ts`.
 */
export const EDITABLE_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.ON_HOLD,
];

/** Statuses that allow customer cancellation. */
export const CUSTOMER_CANCELLABLE: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.CONFIRMED];

/**
 * Statuses where a shipment row means "we are preparing it", not "it already
 * left". Decides which of the two customer-cancel refusals is honest: an order
 * still in this window gets the "being prepared, contact us" copy, one past it
 * gets the plain status refusal (finding AD4).
 */
export const IN_FULFILMENT: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.ON_HOLD,
];

/**
 * Statuses past which the order is finished and no shipment may be created or
 * moved (finding AD4). Distinct from the empty rows in `STATUS_TRANSITIONS`:
 * that map governs the order, this one governs the shipment routes hanging off
 * it, which had no order-status check at all.
 */
export const CLOSED_STATUSES: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.COMPLETED,
  OrderStatus.RETURNED,
];

// ── Sort field allowlists ────────────────────────────────────────────────────

export const VALID_ORDER_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'total',
  'orderNumber',
  'status',
] as const;

export const VALID_ADMIN_ORDER_SORT_FIELDS = [...VALID_ORDER_SORT_FIELDS, 'paymentStatus'] as const;

// ── Events ───────────────────────────────────────────────────────────────────

export const ORDER_EVENTS = {
  CREATED: 'order.created',
  CONFIRMED: 'order.confirmed',
  STATUS_CHANGED: 'order.status_changed',
  CANCELLED: 'order.cancelled',
  SHIPPED: 'order.shipped',
  DELIVERED: 'order.delivered',
} as const;
