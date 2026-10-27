/**
 * Mail module constants.
 *
 * Pinned to keep the wider plan (`specs` references, ops runbook) and the
 * code in agreement.
 */

/** BullMQ queue name — registered in `MailModule` + injected into the processor. */
export const MAIL_QUEUE = 'mail';

/** ProcessedWebhook `provider` key for Resend inbound events. */
export const RESEND_PROVIDER = 'resend';

/**
 * BullMQ worker concurrency. Sits one below Resend's documented 5 req/s
 * team-wide cap so a single api instance never saturates it; combined with
 * the rate-limiter below this is the only throttle on outbound mail.
 */
export const MAIL_WORKER_CONCURRENCY = 4;

/**
 * BullMQ rate-limiter — `max` jobs every `duration` ms. Mirrors the Resend
 * team cap. BullMQ enforces this per queue (not per worker), so multiple api
 * instances will share the budget naturally as long as they share Redis.
 */
export const MAIL_RATE_LIMITER = { max: 5, duration: 1000 } as const;

/**
 * NotificationLog.status literal union. `String` in Prisma (no enum) — the
 * cost of a new value is zero migrations. Order matches the lifecycle:
 *
 *   queued      → enqueue() wrote the audit row, BullMQ owns it
 *   sent        → Resend `emails.send` returned an id; webhook `email.sent`
 *                 may also set this if it arrives before the synchronous
 *                 response (rare)
 *   delivered   → Resend webhook `email.delivered`
 *   bounced     → Resend webhook `email.bounced`
 *   complained  → Resend webhook `email.complained` — also inserts a row
 *                 into EmailSuppression
 *   failed      → all BullMQ attempts exhausted; manual operator triage
 *   suppressed  → EmailSuppression hit before enqueue; never dispatched
 *   skipped     → per-flow kill-switch (sendEnabled=false) or global pause
 *                 tripped before the queue add; never dispatched (NE1)
 *   enqueue-failed → the dispatch bridge (resolver or queue.add) threw before a
 *                 job was handed off; the audit row preserves the "never drop
 *                 silently" contract (NE4, Risk R10)
 */
export type NotificationLogStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'suppressed'
  | 'skipped'
  | 'enqueue-failed';

/** Channel literal — NotificationLog.channel + NotificationTemplate.channel. */
export const NOTIFICATION_CHANNEL_EMAIL = 'email' as const;

/**
 * Delivery class on NotificationTemplate.category. TRANSACTIONAL always sends
 * (gated only by suppression + the kill-switch); LIFECYCLE/MARKETING gain a
 * consent + unsubscribe gate in phase NE7.
 */
export const NOTIFICATION_CATEGORIES = ['TRANSACTIONAL', 'LIFECYCLE', 'MARKETING'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * The consent-gated, customer-editable categories (NE7). TRANSACTIONAL is
 * deliberately excluded — those flows (auth/order/refund) always send and carry
 * no preference row. The enqueue consent gate runs only for these; the
 * storefront preference center renders a toggle row per entry.
 */
export const CONSENT_CATEGORIES = ['LIFECYCLE', 'MARKETING'] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

/**
 * Event emitted whenever a NotificationTemplate is created / updated / removed.
 * MailService listens for it to invalidate its in-memory send-flag cache, so a
 * toggle in the admin propagates without waiting for the TTL backstop (Risk R3).
 */
export const NOTIFICATION_TEMPLATE_CHANGED_EVENT = 'notification-template.changed';

/**
 * Global "pause all email" switch — a StoreSetting row. When `true`, the
 * enqueue gate skips every flow EXCEPT the non-disableable locked set
 * (auth/security must keep flowing so operators can never lock themselves out).
 */
export const NOTIFICATIONS_PAUSE_SETTING = {
  group: 'notifications',
  key: 'pauseAll',
} as const;

/**
 * The constitutional non-disableable set (operator decision 2): security/legal
 * flows that must always send. This hardcoded floor is checked IN ADDITION to
 * the DB `isLocked` column so a missing or corrupted template row can never
 * darken auth or order mail. Refund-confirmation flows join this set in NE5.
 *
 * NOTE: the lock rule is coupled across three sites — keep them in sync:
 *   1. this hardcoded floor (the runtime safety net);
 *   2. the migration backfill (`..._notification_template_send_gate/migration.sql`);
 *   3. the seed derivation (`prisma/seed.ts` seedNotificationTemplates).
 * A future flow that is NOT `auth.*`/`order.*` (e.g. a `refund.*` confirmation)
 * must be added to all three, not just the DB column.
 */
export function isLockedFlow(code: string): boolean {
  return code.startsWith('auth.') || code.startsWith('order.');
}
