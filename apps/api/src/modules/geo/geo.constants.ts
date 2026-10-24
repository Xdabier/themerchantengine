import { type CatalogueLocale, storeLocales } from '@common/locale';
// ── BullMQ ────────────────────────────────────────────────────────────────────

export const GEO_LLMS_TXT_QUEUE = 'geo-llms-txt';
export const GEO_LLMS_TXT_JOB = 'generate';

export const GEO_CONTENT_FRESHNESS_QUEUE = 'geo-content-freshness';
export const GEO_CONTENT_FRESHNESS_JOB = 'check';

/** Cron: every 6 hours (llms.txt regeneration) */
export const GEO_LLMS_TXT_CRON = '0 */6 * * *';

/** Cron: daily at 02:00 (content freshness check) */
export const GEO_CONTENT_FRESHNESS_CRON = '0 2 * * *';

// ── Redis ─────────────────────────────────────────────────────────────────────

export const GEO_REDIS_CLIENT = 'GEO_REDIS_CLIENT';

/** Per-locale cache key prefix for llms.txt: geo:llms.txt:<locale> */
export const GEO_LLMS_TXT_CACHE_PREFIX = 'geo:llms.txt:';

/**
 * Per-locale cache key prefix for llms-full.txt: geo:llms-full.txt:<locale>
 *
 * The comprehensive catalogue file (every active product, every visible
 * category, full policy bodies) consumed by AI inference layers in one shot.
 * Regenerated alongside `llms.txt` in the same BullMQ job to keep the two
 * surfaces coherent.
 */
export const GEO_LLMS_FULL_TXT_CACHE_PREFIX = 'geo:llms-full.txt:';

/** 6-hour TTL for llms.txt cache */
export const GEO_LLMS_TXT_TTL_SECONDS = 6 * 60 * 60;

/**
 * Batch size for the comprehensive llms-full.txt product walk. Mirrors the
 * SEO sitemap batching pattern (apps/api/src/modules/seo/seo.constants.ts
 * SITEMAP_BATCH_SIZE) so memory pressure stays bounded on large catalogues.
 */
export const GEO_LLMS_FULL_BATCH_SIZE = 500;

// ── Content freshness ─────────────────────────────────────────────────────────

/** Number of days after which content is considered stale */
export const CONTENT_STALE_DAYS = 90;

/** Notification type string sent to admins when stale content is found */
export const CONTENT_STALE_NOTIFICATION_TYPE = 'CONTENT_STALE';

// ── llms.txt generation ───────────────────────────────────────────────────────

/**
 * Section caps for the short llms.txt index file.
 *
 * Bumped from 10/20 in 2026-05-06 — a client catalogue grew past 200 SKUs
 * and the original caps emitted < 5% of the catalogue, hurting AI inference
 * coverage. These caps still keep the file under ~50 KB; the comprehensive
 * catalogue lives at /llms-full.txt for crawlers that want the whole tree.
 */
export const GEO_TOP_CATEGORIES_COUNT = 50;
export const GEO_POPULAR_PRODUCTS_COUNT = 100;

/**
 * Placeholder address fragments that callers should treat as "unset" and omit
 * from emitted output (llms.txt Contact line, JSON-LD `email`/`telephone`).
 * Set when `store.config.ts` shipped legacy `support@example.com`-style
 * defaults; kept as a defence layer in case any prod DB row still carries one.
 */
export const PLACEHOLDER_CONTACT_VALUES: ReadonlySet<string> = new Set([
  'support@example.com',
  '+1-800-123-4567',
]);

/** The locales llms.txt is generated for: the store's enabled set (DR-31). */
export function geoSupportedLocales(): readonly string[] {
  return storeLocales.current().supportedLocales;
}
export type GeoLocale = CatalogueLocale;

// ── FAQ auto-generation ───────────────────────────────────────────────────────

/** Number of generic FAQ suggestions to produce per product */
export const GEO_FAQ_SUGGESTIONS_COUNT = 3;

/**
 * Generic FAQ templates shown when a product has no FAQs.
 * Translatable objects — the admin can accept or edit before saving.
 */
export const GEO_FAQ_TEMPLATES = [
  {
    question: {
      default: 'Cet article existe-t-il en plusieurs tailles ou variantes ?',
      fr: 'Cet article existe-t-il en plusieurs tailles ou variantes ?',
      en: 'Is this item available in different sizes or variants?',
      ar: 'هل يتوفر هذا المنتج بمقاسات أو خيارات مختلفة؟',
    },
    answer: {
      default: 'Les options disponibles sont listées sur la fiche produit.',
      fr: 'Les options disponibles sont listées sur la fiche produit.',
      en: 'The available options are listed on the product page.',
      ar: 'الخيارات المتاحة مذكورة في صفحة المنتج.',
    },
  },
  {
    question: {
      default: 'Quelle est la politique de retour pour ce produit ?',
      fr: 'Quelle est la politique de retour pour ce produit ?',
      en: 'What is the return policy for this product?',
      ar: 'ما هي سياسة الإرجاع لهذا المنتج؟',
    },
    answer: {
      default: 'Nous acceptons les retours sous 14 jours, dans leur état d’origine.',
      fr: 'Nous acceptons les retours sous 14 jours, dans leur état d’origine.',
      en: 'We accept returns within 14 days, in their original condition.',
      ar: 'نقبل الإرجاع خلال 14 يومًا بحالته الأصلية.',
    },
  },
  {
    question: {
      default: 'Cet article est-il en stock ?',
      fr: 'Cet article est-il en stock ?',
      en: 'Is this item currently in stock?',
      ar: 'هل هذا المنتج متوفر في المخزون حاليًا؟',
    },
    answer: {
      default: 'L’état du stock est indiqué sur la fiche produit.',
      fr: 'L’état du stock est indiqué sur la fiche produit.',
      en: 'The current stock status is shown on the product page.',
      ar: 'حالة المخزون الحالية موضحة في صفحة المنتج.',
    },
  },
] as const;

// ── AI readiness ──────────────────────────────────────────────────────────────

/** Minimum description length (chars) to count as "answer-first" */
export const GEO_MIN_DESCRIPTION_LENGTH = 100;
