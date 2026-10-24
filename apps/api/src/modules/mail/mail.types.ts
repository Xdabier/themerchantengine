/**
 * Mail module — public-API types.
 *
 * `MailJobName` is the single source of truth for which transactional flows
 * exist. Add a new flow only by extending the union AND adding the matching
 * template under `./templates/<code>.ts` AND seeding the NotificationTemplate
 * row in `prisma/seed.ts`.
 */

import { registryLocaleCodes, storeLocales } from '@common/locale';

export type MailJobName =
  | 'auth.password-reset'
  | 'auth.email-verification'
  | 'auth.magic-link'
  | 'auth.change-email-verification'
  | 'auth.delete-account'
  | 'auth.password-changed'
  | 'auth.email-change-alert'
  | 'customer.welcome'
  | 'order.placed'
  | 'order.shipped'
  | 'order.delivered'
  | 'order.cancelled'
  | 'order.confirmed'
  | 'order.exchange-created'
  | 'giftcard.purchase'
  | 'giftcard.redeemed'
  | 'giftcard.store-credit'
  | 'return.requested'
  | 'return.approved'
  | 'return.rejected'
  | 'return.received'
  | 'return.refunded'
  | 'question.answered'
  | 'review.approved'
  | 'cart.abandoned'
  | 'admin.staff-invite'
  | 'contact-form'
  // NE8 — staff digests + scheduled lifecycle flows
  | 'product.back-in-stock'
  | 'review.request'
  | 'giftcard.expiry-reminder'
  | 'auth.2fa-otp'
  | 'auth.2fa-enabled'
  | 'auth.2fa-disabled'
  | 'admin.ops-digest'
  | 'admin.kpi-digest'
  // NE9 — marketing / broadcast plane
  | 'newsletter.confirm';

/**
 * Every registry code, read once when the module loads. A message is written in
 * the store default when a code has no copy (DR-33), and the store's locale set
 * decides which codes are enabled, never this list's order.
 */
export const MAIL_LOCALES: readonly string[] = registryLocaleCodes();

/**
 * Any registry code. A language a template ships no copy for still renders, by
 * falling back key by key to the store default (DR-33), so the type is open.
 */
export type MailLocale = string;

/**
 * The locale a stranger is written to: the store's default locale from the
 * runtime config. Deliberately the same rung the global Translatable
 * interceptor falls back to, so the language a customer is addressed in and
 * the stored translation they are shown can never disagree.
 */
export function defaultMailLocale(): MailLocale {
  return storeLocales.current().defaultLocale;
}

/**
 * What a template needs to know about the store it speaks for, resolved by
 * the caller from the runtime config for the message locale. Templates never
 * read settings themselves: the renderer hands this in, so the file-fallback
 * tier and the seeded tier print the same name.
 */
export interface MailBrand {
  /** The store name, already resolved to the message locale. */
  storeName: string;
}

/**
 * The fully-rendered payload handed to Resend. Renderers always produce both
 * html + text so non-HTML clients see something useful and Gmail's plain-text
 * preview is not stripped from the rendered HTML.
 */
export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

/**
 * Payload carried on every BullMQ job.
 *
 * `logId` is the NotificationLog row id written by `MailService.enqueue`
 * *before* the queue add — the processor updates the same row on send so
 * audit history stays single-row per dispatch.
 *
 * `actionUrl` is recorded into `metadata.actionUrl` in non-production only
 * so the e2e helper `recentActionUrl()` can follow verification / reset /
 * magic-link without an inbox round-trip.
 */
export interface MailJobPayload<V = Record<string, unknown>> {
  to: string;
  locale: MailLocale;
  variables: V;
  logId: string;
  actionUrl?: string;
  replyTo?: string;
  bcc?: string[];
  /**
   * RFC 8058 unsubscribe URL (NE7). Set by `enqueue` ONLY for a consented
   * non-transactional send. The processor adds the `List-Unsubscribe` +
   * `List-Unsubscribe-Post` headers and a footer link when present; transactional
   * mail carries neither (a List-Unsubscribe on a password-reset would be wrong).
   */
  listUnsubscribeUrl?: string;
}

/**
 * The shape `MailService.enqueue()` accepts from callers — same as
 * MailJobPayload but without `logId`, which the service fills in.
 *
 * `dedupeKey` is an optional stable idempotency key. When set, it becomes the
 * BullMQ `jobId` (and therefore the Resend Idempotency-Key) so a repeated
 * enqueue of the same logical send — e.g. an admin double-clicking "resend" —
 * dedupes to a single dispatch instead of mailing the recipient twice. Callers
 * that omit it keep the prior behaviour (jobId = the fresh NotificationLog id).
 */
export type MailEnqueueInput<V = Record<string, unknown>> = Omit<
  MailJobPayload<V>,
  'logId' | 'listUnsubscribeUrl'
> & {
  dedupeKey?: string;
  /**
   * Skip the NE7 consent gate for this one send. Set ONLY by the admin
   * "send test to me" path (NE6) — an operator previewing a LIFECYCLE/MARKETING
   * template to their OWN inbox is not customer marketing volume, so consent
   * does not apply. Suppression + the kill-switch still apply. Event-driven
   * sends and admin resend never set it (resend must honour current consent).
   */
  bypassConsent?: boolean;
};

/** What enqueue returns to the caller. */
export interface MailEnqueueResult {
  logId: string;
  jobId: string | undefined;
  /** `true` when EmailSuppression short-circuited the send — no queue add. */
  suppressed: boolean;
  /**
   * `true` when the per-flow kill-switch (sendEnabled=false) or the global
   * pause short-circuited the send — a NotificationLog `status='skipped'` row
   * is written but no queue add happens (NE1).
   */
  skipped?: boolean;
  /**
   * `true` when a `dedupeKey` matched a job already in the queue — enqueue was
   * an idempotent no-op (no new audit row, no second dispatch) and `logId`
   * points at the original send's row (NE2).
   */
  deduped?: boolean;
  /**
   * `true` when the BullMQ `queue.add` threw after the audit row was written —
   * the row is updated to `status='enqueue-failed'` and enqueue returns instead
   * of throwing, so the caller (and the originating domain mutation) is never
   * interrupted by a transient queue outage (NE4, Risk R10).
   */
  enqueueFailed?: boolean;
}
