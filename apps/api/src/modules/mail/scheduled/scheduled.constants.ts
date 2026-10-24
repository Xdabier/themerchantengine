/**
 * NE8 scheduled + delayed mail producers — queue names, job names, cron
 * patterns, and tuning constants. BullMQ-only (the repo has no @nestjs/schedule);
 * repeatable producers register a `repeat.pattern` in onModuleInit with a stable
 * jobId, delayed jobs use `queue.add(name, data, { delay })`.
 */

// ── Review-request (delayed off order.delivered) ─────────────────────────────
export const REVIEW_REQUEST_QUEUE = 'review-request';
export const REVIEW_REQUEST_JOB = 'request';
/** Delay after order.delivered before soliciting a review (3 days). */
export const REVIEW_REQUEST_DELAY_MS = 3 * 24 * 60 * 60 * 1000;

// ── Gift-card expiry reminder (daily scan) ───────────────────────────────────
export const GIFT_CARD_EXPIRY_QUEUE = 'gift-card-expiry';
export const GIFT_CARD_EXPIRY_JOB = 'scan';
/** Cron: daily at 08:00. */
export const GIFT_CARD_EXPIRY_CRON = '0 8 * * *';
/** Reminder marks — fire once when a card is this many days from expiresAt. */
export const GIFT_CARD_EXPIRY_MARKS = [14, 3] as const;
/** Width of a reminder window in days — the daily scan catches a card once per mark. */
export const GIFT_CARD_EXPIRY_WINDOW_DAYS = 1;

// ── Staff digests (daily ops + weekly KPI) ───────────────────────────────────
export const STAFF_DIGEST_QUEUE = 'staff-digest';
export const STAFF_OPS_DIGEST_JOB = 'ops-digest';
export const STAFF_KPI_DIGEST_JOB = 'kpi-digest';
/** Cron: daily at 07:00 (operations roll-up). */
export const STAFF_OPS_DIGEST_CRON = '0 7 * * *';
/** Cron: Monday at 07:00 (weekly performance roll-up). */
export const STAFF_KPI_DIGEST_CRON = '0 7 * * 1';
