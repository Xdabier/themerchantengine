/**
 * Customer-facing order projection — constitution §3.5 ("separate admin vs
 * customer DTOs").
 *
 * This is an allowlist, not an omit list. The leak it closes (finding AD2) came
 * from returning the raw Prisma row: `internalNotes`, written by admins through
 * `PATCH /v1/admin/orders/:id`, rode straight back out on the owner's
 * `GET /v1/orders/:id`. An omit list would have to be extended by hand for every
 * future internal column and fails open when nobody remembers; an allowlist
 * leaves a new column off the customer wire until someone adds it here on
 * purpose.
 *
 * Admin read paths (`findOneAdmin`, `listAdmin`, the admin status route,
 * `exportCsv`) deliberately do NOT go through this. The admin edit form
 * round-trips `internalNotes` and would break without it.
 */

/** A Prisma `Decimal`, a plain number, or nothing. */
type Decimalish = { toNumber(): number } | number | null | undefined;

/** Decimal | number | null to number. Money crosses the wire as a number. */
export function toNum(value: Decimalish): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'object' ? value.toNumber() : value;
}

/**
 * Every `Order` scalar a customer may read, mirroring `model Order` in
 * `prisma/schema.prisma`.
 *
 * Excluded on purpose:
 * - `internalNotes` — admin-only; the field finding AD2 was about.
 * - `idempotencyKey` — its schema comment declares it an audit mirror of the
 *   Redis key, so it is not a response field.
 * - `userId` and the `user` relation — the owner's own data, so not a
 *   cross-customer leak, but admin-shape payload the storefront neither types
 *   (`libs/storefront-types` `orderSchema`) nor reads.
 * - `paymentReference`: the provider's session or charge id (DR-34). Webhooks
 *   resolve an order by it, and the customer has no use for it.
 *
 * `notes` stays: that is the customer's own checkout note.
 */
export const CUSTOMER_ORDER_FIELDS = [
  'id',
  'orderNumber',
  'status',
  'paymentStatus',
  'shippingAddress',
  'billingAddress',
  'currency',
  'shippingMethodName',
  // The tender the customer chose, snapshotted at order time. Visible for the
  // same reason `shippingMethodName` is: it is what they were told they were
  // paying with, and the confirmation page has to be able to say it back.
  //
  // Written by `createOrder` since plan F phase F5. NULL on every order placed
  // before it, so a consumer must treat null as "not recorded", never as a
  // tender.
  'paymentMethodCode',
  'paymentMethodName',
  // A guest's own contact address, on their own order. Not a leak: this row is
  // only reachable by the browser that placed it or by the account that owns
  // it, and echoing it lets the confirmation page name where the receipt went.
  //
  // `guestSessionId` and `guestLocale` are deliberately NOT here.
  // `guestSessionId` is the bearer credential for this order: anything holding
  // it can read the order, so it must never travel in a response body where a
  // log, a screenshot or an injected script could pick it up. `guestLocale` is
  // internal mail plumbing with nothing to say to a customer.
  'guestEmail',
  'couponCode',
  'notes',
  'createdAt',
  'updatedAt',
  'deliveredAt',
] as const;

/** Order money columns, remapped from Decimal to number on the way out. */
export const CUSTOMER_ORDER_MONEY_FIELDS = [
  'subtotal',
  'discountAmount',
  'shippingAmount',
  'taxAmount',
  'total',
] as const;

/**
 * Order relations a customer may read. Their own rows are owner-appropriate
 * end to end: `OrderItem` down to the digital-delivery `downloadUrl` family,
 * `Shipment`, and the immutable `Invoice` totals snapshot.
 *
 * `statusHistory` is deliberately NOT here. Its rows carry an id, an `orderId`
 * and a `fromStatus` the customer timeline has no use for, so it is projected
 * rather than passed through; see `toCustomerStatusHistory`.
 */
export const CUSTOMER_ORDER_RELATIONS = ['items', 'shipments', 'invoice'] as const;

/**
 * `OrderStatusHistory` rows, reduced to the two fields the customer timeline
 * renders (finding AD6). Ascending by `createdAt`, which is the order the
 * `ORDER_INCLUDE` query already asks for.
 *
 * A projection rather than an allowlist entry because the shape differs from
 * the stored row: `toStatus` becomes `status`, `createdAt` becomes `at`, and
 * the internal columns are dropped.
 */
export function toCustomerStatusHistory(rows: unknown): Row[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const r = row as Row;
    return { status: r['toStatus'], at: r['createdAt'] };
  });
}

/** `OrderItem` money columns, remapped the same way. */
const CUSTOMER_ORDER_ITEM_MONEY_FIELDS = [
  'unitPrice',
  'discountAmount',
  'taxAmount',
  'total',
] as const;

type Row = Record<string, unknown>;

/**
 * Item rows pass through whole. Every `OrderItem` column is a snapshot of what
 * the customer bought, so there is nothing admin-only to strip, and siblings
 * that widen the line (plan A adds `productSlug`) keep working without touching
 * this file. Only the money columns are remapped.
 */
function toCustomerOrderItem(item: Row): Row {
  const out: Row = { ...item };
  for (const field of CUSTOMER_ORDER_ITEM_MONEY_FIELDS) {
    if (field in item) out[field] = toNum(item[field] as Decimalish);
  }
  return out;
}

/**
 * Projects a Prisma order row onto the customer shape.
 *
 * Absent keys stay absent rather than becoming `null`, so a caller that
 * selected a narrower row does not gain keys it never asked for.
 */
export function toCustomerOrder(order: Row): Row {
  const out: Row = {};

  for (const field of CUSTOMER_ORDER_FIELDS) {
    if (field in order) out[field] = order[field];
  }
  for (const field of CUSTOMER_ORDER_MONEY_FIELDS) {
    if (field in order) out[field] = toNum(order[field] as Decimalish);
  }
  for (const relation of CUSTOMER_ORDER_RELATIONS) {
    if (!(relation in order)) continue;
    out[relation] =
      relation === 'items' && Array.isArray(order[relation])
        ? (order[relation] as Row[]).map(toCustomerOrderItem)
        : order[relation];
  }
  if ('statusHistory' in order) {
    out['statusHistory'] = toCustomerStatusHistory(order['statusHistory']);
  }

  return out;
}
