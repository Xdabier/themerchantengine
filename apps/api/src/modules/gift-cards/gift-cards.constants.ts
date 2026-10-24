// ── BullMQ ────────────────────────────────────────────────────────────────────

export const GIFT_CARD_RECONCILIATION_QUEUE = 'gift-card-reconciliation';
export const GIFT_CARD_RECONCILIATION_JOB = 'reconcile';

/** Cron: daily at 04:00 */
export const GIFT_CARD_RECONCILIATION_CRON = '0 4 * * *';

/**
 * Allowlist of GiftCard columns that may be used as sort fields in admin queries.
 * Any value outside this set is rejected before it reaches Prisma (§08 convention).
 */
export const GIFT_CARD_SORT_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'initialBalance',
  'currentBalance',
  'expiresAt',
  'recipientEmail',
]);

export const DEFAULT_SORT_FIELD = 'createdAt';
export const DEFAULT_SORT_ORDER = 'desc' as const;

/** Alphabet used for auto-generated 16-char redemption codes. */
export const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const CODE_LENGTH = 16;

// ── EventEmitter2 event names ─────────────────────────────────────────────────

/**
 * Gift-card domain events. The mail module's declarative dispatch table
 * (MailDispatchListener) binds `giftcard.purchased` (delivers the code to the
 * recipient) and `giftcard.redeemed` (sends the receipt to the purchaser).
 */
export const GIFT_CARD_EVENTS = {
  PURCHASED: 'giftcard.purchased',
  REDEEMED: 'giftcard.redeemed',
  /** Admin granted store credit to a recipient email (NE5) — not a return refund. */
  STORE_CREDIT_ISSUED: 'giftcard.store-credit-issued',
} as const;
