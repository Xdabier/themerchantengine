import { LOCALE_CATALOGUE } from '@common/locale';
/**
 * Campaigns module constants (NE9 — marketing / broadcast plane).
 *
 * The headline invariant (plan §3g, Risk R9): the campaign plane has its OWN
 * BullMQ queue + rate budget, so a 50k-recipient broadcast can never starve a
 * password-reset or burn the transactional 5 req/s budget. It shares only the
 * provider seam (ResendClient) + the suppression truth (SuppressionService).
 */

/** BullMQ queue for batched campaign fan-out — NEVER the transactional `mail` queue. */
export const CAMPAIGN_QUEUE = 'campaign';

/** Job name for "send the next batch of this campaign". */
export const CAMPAIGN_SEND_JOB = 'campaign.send-batch';

/** Scheduled win-back queue + cron job. */
export const WINBACK_QUEUE = 'campaign-winback';
export const WINBACK_JOB = 'campaign.winback';
/** Weekly, Monday 09:00 — gentle re-engagement cadence. */
export const WINBACK_CRON = '0 9 * * 1';

/**
 * Campaign-plane rate limiter — deliberately gentler than the transactional
 * `MAIL_RATE_LIMITER`. Each job is one `batch.send` of up to CAMPAIGN_BATCH_SIZE
 * recipients, so 2 jobs/sec is up to ~200 emails/sec without monopolising the
 * Resend account. BullMQ enforces it per queue across instances sharing Redis.
 */
export const CAMPAIGN_RATE_LIMITER = { max: 2, duration: 1000 } as const;

/** Campaign worker concurrency — low; the batch API does the fan-out. */
export const CAMPAIGN_WORKER_CONCURRENCY = 2;

/** Resend `batch.send` hard cap — recipients are chunked to this per job. */
export const CAMPAIGN_BATCH_SIZE = 100;

/** Campaign lifecycle states (Campaign.status). */
export const CAMPAIGN_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'SENDING',
  'SENT',
  'CANCELLED',
  'FAILED',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Campaign authorship (Campaign.kind). */
export const CAMPAIGN_KINDS = ['BROADCAST', 'WINBACK'] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

/**
 * Audience selectors (Campaign.segment).
 *  - ALL_CONFIRMED: every confirmed, non-unsubscribed Subscriber.
 *  - NEW/ACTIVE/LOYAL/AT_RISK/CHURNED: confirmed subscribers whose linked User
 *    matches that order-history segment (anonymous subscribers are excluded from
 *    a segment-filtered broadcast — they have no order history to classify).
 *  - LAPSED: AT_RISK ∪ CHURNED — used by the system win-back campaign, which
 *    targets consenting account customers (not the subscriber list).
 */
export const CAMPAIGN_SEGMENTS = [
  'ALL_CONFIRMED',
  'NEW',
  'ACTIVE',
  'LOYAL',
  'AT_RISK',
  'CHURNED',
  'LAPSED',
] as const;
export type CampaignSegment = (typeof CAMPAIGN_SEGMENTS)[number];

/** Subscriber signup provenance (Subscriber.source). */
export const SUBSCRIBER_SOURCES = ['newsletter-footer', 'checkout', 'import', 'admin'] as const;
export type SubscriberSource = (typeof SUBSCRIBER_SOURCES)[number];

/**
 * The locale a newsletter signup arrives with (Subscriber.locale).
 *
 * This is a **storefront** locale. It is stored, and it is interpolated into
 * the storefront confirm-redirect URL, so it has to be a segment the storefront
 * actually routes. `MailLocale` answers a different question: which language a
 * message is written in.
 */
/** A subscriber row may carry any catalogue locale; the send path resolves it against the enabled set. */
export const SUBSCRIBER_LOCALES = LOCALE_CATALOGUE;
export type SubscriberLocale = string;

/**
 * The consent category a campaign send honours. Newsletter subscribers consent
 * via double opt-in (Subscriber.confirmedAt); account customers reached by the
 * win-back job consent via the MARKETING NotificationPreference row. The
 * unsubscribe token for a campaign carries this category.
 */
export const CAMPAIGN_CONSENT_CATEGORY = 'MARKETING' as const;
