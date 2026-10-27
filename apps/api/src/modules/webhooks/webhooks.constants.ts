// ── Queue ────────────────────────────────────────────────────────────────────

/** BullMQ queue name for outbound webhook deliveries. */
export const WEBHOOK_DELIVERY_QUEUE = 'webhook-delivery';

/** Job name used when adding delivery jobs. */
export const WEBHOOK_DELIVERY_JOB = 'deliver';

// ── Delivery policy ──────────────────────────────────────────────────────────

/**
 * Retry delays in milliseconds per attempt (spec §4.23).
 * Index 0 = delay before attempt 2 (first retry), etc.
 * Sequence: 1 min → 5 min → 30 min → 2 hr → 24 hr.
 */
export const RETRY_DELAYS_MS = [
  1 * 60 * 1_000, // 1 minute
  5 * 60 * 1_000, // 5 minutes
  30 * 60 * 1_000, // 30 minutes
  2 * 60 * 60 * 1_000, // 2 hours
  24 * 60 * 60 * 1_000, // 24 hours
] as const;

/** Total delivery attempts per event (initial + 4 retries = 5). */
export const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_MS.length;

/**
 * After this many consecutive fully-failed delivery sequences, the
 * subscription is automatically deactivated (spec §4.23).
 */
export const MAX_CONSECUTIVE_FAILURES = 5;

/** HTTP request timeout for outbound webhook delivery in milliseconds. */
export const DELIVERY_TIMEOUT_MS = 10_000;

// ── Secret ───────────────────────────────────────────────────────────────────

/** Byte length of auto-generated HMAC secrets (produces 64-char hex string). */
export const WEBHOOK_SECRET_BYTES = 32;

/** Signature header sent with every delivery (spec §4.23). */
export const WEBHOOK_SIGNATURE_HEADER = 'X-Webhook-Signature';

/** Payload schema version included in every delivery body. */
export const WEBHOOK_PAYLOAD_VERSION = '1.0';

// ── Pagination ───────────────────────────────────────────────────────────────

export const WEBHOOKS_DEFAULT_PAGE_SIZE = 20;
export const WEBHOOKS_MAX_PAGE_SIZE = 100;
export const DELIVERIES_DEFAULT_PAGE_SIZE = 20;
export const DELIVERIES_MAX_PAGE_SIZE = 100;

// ── Event catalog (spec §4.23) ───────────────────────────────────────────────

export const WEBHOOK_EVENT_TYPES = [
  'order.created',
  'order.confirmed',
  'order.status_changed',
  'order.cancelled',
  'order.shipped',
  'order.delivered',
  'product.created',
  'product.updated',
  'product.deleted',
  'inventory.low_stock',
  'inventory.out_of_stock',
  'inventory.restocked',
  'customer.created',
  'customer.updated',
  'cart.abandoned',
  'return.requested',
  'return.approved',
  'return.refunded',
  'review.submitted',
  'payment.received',
  'payment.refunded',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
