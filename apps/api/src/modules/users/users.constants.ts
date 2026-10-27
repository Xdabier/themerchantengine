// ── BullMQ ────────────────────────────────────────────────────────────────────

export const CUSTOMER_SEGMENTATION_QUEUE = 'customer-segmentation';
export const CUSTOMER_SEGMENTATION_JOB = 'recompute';

/** Cron: daily at 03:00 */
export const CUSTOMER_SEGMENTATION_CRON = '0 3 * * *';

// ── EventEmitter2 event names ─────────────────────────────────────────────────

/**
 * User-account domain events (NE5). The mail dispatch table binds
 * `users.staff-invited` (admin invite notice) and `users.password-changed`
 * (security alert to the owner address — never deduped, each change is distinct).
 */
export const USER_EVENTS = {
  STAFF_INVITED: 'users.staff-invited',
  PASSWORD_CHANGED: 'users.password-changed',
} as const;
