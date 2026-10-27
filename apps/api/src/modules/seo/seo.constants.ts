import { type CatalogueLocale, storeLocales } from '@common/locale';
// ── BullMQ ────────────────────────────────────────────────────────────────────

export const SEO_SITEMAP_QUEUE = 'seo-sitemap';
export const SEO_SITEMAP_JOB = 'generate';

/** Cron: every 6 hours */
export const SEO_SITEMAP_CRON = '0 */6 * * *';

/** Daily active probe of GSC/Bing/public-sitemap submission health (DR-16). */
export const SEO_SUBMISSION_HEALTH_JOB = 'submission-health';
/** Cron: daily 06:30 (after the 06:00 sitemap regen tick). */
export const SEO_SUBMISSION_HEALTH_CRON = '30 6 * * *';
export const SEO_SUBMISSION_HEALTH_CACHE_KEY = 'seo:submission-health';
/** 36-hour TTL so a single missed daily run still leaves yesterday's snapshot readable. */
export const SEO_SUBMISSION_HEALTH_TTL_SECONDS = 36 * 60 * 60;

export const GOOGLE_MERCHANT_FEED_QUEUE = 'google-merchant-feed';
export const GOOGLE_MERCHANT_FEED_JOB = 'generate';

/** Cron: every 6 hours */
export const GOOGLE_MERCHANT_FEED_CRON = '0 */6 * * *';

export const GOOGLE_MERCHANT_FEED_CACHE_KEY = 'seo:merchant-feed';

/** 6-hour TTL for merchant feed cache */
export const GOOGLE_MERCHANT_FEED_TTL_SECONDS = 6 * 60 * 60;

// ── DI tokens ─────────────────────────────────────────────────────────────────

/** Stable token re-exporting SettingsService for SEO consumers. Same pattern as
 * GEO_SETTINGS_SERVICE (geo.module.ts:41) — keeps the cross-module injection
 * decoupled from the concrete SettingsService class so the SEO module can
 * be tested in isolation against a mock. Consumed by SeoStorefrontController
 * (S24.5) and SeoService (S24.6) for `business.*` group reads. */
export const SEO_SETTINGS_SERVICE = 'SEO_SETTINGS_SERVICE';

/** Stable token re-exporting the products read service (DR-17 D2). Mirrors
 * SEO_SETTINGS_SERVICE so the SEO submit orchestrator resolves productIds →
 * active slugs through a narrow `SeoProductsReader` interface (§3.1 modular
 * isolation — no direct cross-module Prisma access) and can be unit-tested
 * against a mock token. */
export const SEO_PRODUCTS_SERVICE = 'SEO_PRODUCTS_SERVICE';

/**
 * Narrow products read seam (§3.1 modular isolation) injected via
 * `SEO_PRODUCTS_SERVICE`. The submit orchestrator (D2 slug resolution) and the
 * URL-Inspection paths (D5 badge + sweep) both resolve products through this
 * interface so the SEO module never touches the products Prisma client directly
 * and can be unit-tested against a mock. Lives here, next to the token, as the
 * single home for the cross-module contract (§3.14).
 */
export interface SeoProductsReader {
  /** Resolve product ids → the `{id, slug}` of the publicly-visible (ACTIVE)
   * ones; unknown/draft/soft-deleted ids are dropped, never errored (D2). */
  resolveActivePublicSlugs(ids: string[]): Promise<{ id: string; slug: string }[]>;
  /** The `limit` most-recently-updated ACTIVE products, freshest first — the
   * URL-Inspection sweep's priority list so the newest/changed SKUs are inspected
   * first under the daily budget (D5). */
  listRecentlyUpdatedActiveSlugs(
    limit: number,
  ): Promise<{ id: string; slug: string; updatedAt: Date }[]>;
}

// ── Redis ─────────────────────────────────────────────────────────────────────

export const SEO_REDIS_CLIENT = 'SEO_REDIS_CLIENT';

export const SEO_SITEMAP_INDEX_CACHE_KEY = 'seo:sitemap:index';
export const SEO_SITEMAP_PRODUCTS_CACHE_KEY = 'seo:sitemap:products';
export const SEO_SITEMAP_CATEGORIES_CACHE_KEY = 'seo:sitemap:categories';
export const SEO_SITEMAP_PAGES_CACHE_KEY = 'seo:sitemap:pages';
export const SEO_ROBOTS_CACHE_KEY = 'seo:robots';

/** 6-hour TTL for sitemap cache */
export const SEO_SITEMAP_TTL_SECONDS = 6 * 60 * 60;
/** 1-hour TTL for robots.txt cache */
export const SEO_ROBOTS_TTL_SECONDS = 60 * 60;

// ── Pagination ────────────────────────────────────────────────────────────────

export const SEO_REDIRECTS_DEFAULT_PAGE_SIZE = 20;
export const SEO_REDIRECTS_MAX_PAGE_SIZE = 100;

// ── Submission audit log (DR-17) ──────────────────────────────────────────────

/** What triggered a SeoSubmission row. */
export const SEO_SUBMISSION_TRIGGERS = ['manual', 'auto-regen', 'cron'] as const;
export type SeoSubmissionTrigger = (typeof SEO_SUBMISSION_TRIGGERS)[number];

/** Target shape of a submission. */
export const SEO_SUBMISSION_TARGET_TYPES = ['url', 'products', 'sitemap'] as const;
export type SeoSubmissionTargetType = (typeof SEO_SUBMISSION_TARGET_TYPES)[number];

/** Engine a submission row records. */
export const SEO_SUBMISSION_ENGINES = ['indexnow', 'gsc', 'bing'] as const;
export type SeoSubmissionEngine = (typeof SEO_SUBMISSION_ENGINES)[number];

export const SEO_SUBMISSIONS_DEFAULT_PAGE_SIZE = 20;
export const SEO_SUBMISSIONS_MAX_PAGE_SIZE = 100;

/** Allowlist for submission-history list sortBy (§3.5 — never interpolated). */
export const VALID_SUBMISSION_SORT_FIELDS = ['createdAt'] as const;

/** Persisted `reason` is truncated to this length so a verbose engine error can
 * never bloat the audit row (the full diagnostic still lands in the WARN log). */
export const SEO_SUBMISSION_REASON_MAX = 500;

// ── Manual reindex submit (DR-17 D2) ──────────────────────────────────────────

/** Cap on `productIds` in a single manual submit — bounds the URL fan-out and
 * the IndexNow batch so one request can't be turned into an unbounded job. */
export const SEO_SUBMIT_MAX_PRODUCT_IDS = 500;

/** Idempotency namespace for `POST /v1/admin/seo/submit` (§3.6 RedisDedupStore
 * scope). A double-click with the same key must not double-burn engine quota. */
export const SEO_SUBMIT_IDEMPOTENCY_SCOPE = 'seo-submit';

/** Which engines a given target type can be submitted to. url/products are
 * per-URL pushes (IndexNow only); a whole sitemap is registered with the
 * crawlers that accept a feed (GSC + Bing). Single source for the orchestrator's
 * applicability narrowing. */
export const SEO_TARGET_ENGINES: Record<SeoSubmissionTargetType, readonly SeoSubmissionEngine[]> = {
  url: ['indexnow'],
  products: ['indexnow'],
  sitemap: ['gsc', 'bing'],
};

// ── Monitoring reads (DR-17 D3) ───────────────────────────────────────────────

/** Sitemap-coverage readout (GSC `sitemaps.list` + Bing `GetFeeds`). Cached 6 h —
 * coverage changes slowly and every read is an engine API call; never turn a page
 * load into a live multi-engine probe (plan §8). */
export const SEO_COVERAGE_CACHE_KEY = 'seo:coverage';
export const SEO_COVERAGE_TTL_SECONDS = 6 * 60 * 60;

/** Bing URL-submission quota readout (`GetUrlSubmissionQuota`). Cached 30 min
 * (plan §8 window: 15–60 min). The Bing quota is ADAPTIVE — it can be single
 * digits; never assume 10 000 (plan §12). */
export const SEO_BING_QUOTA_CACHE_KEY = 'seo:quota:bing';
export const SEO_BING_QUOTA_TTL_SECONDS = 30 * 60;

/** GSC URL-Inspection daily-budget counter (the scarcest SEO resource — 2 000/day
 * per property). Keyed by the America/Los_Angeles date so it matches Google's
 * midnight-PT reset. D3 only READS it for the quota readout; D5's URL-Inspection
 * sweep INCRs it. */
export const SEO_GSC_INSPECT_BUDGET_PREFIX = 'seo:gsc:inspect:count:';
export const SEO_GSC_INSPECT_DAILY_CAP = 2000;

/** Single source (§3.14) for the IndexNow per-URL anti-spam window. The dedup
 * SET NX EX in `search-engine-submit.service.ts` and the `/quota` readout both
 * derive from it so the advertised window can never drift from the enforced one. */
export const SEO_INDEXNOW_DEDUP_WINDOW_SECONDS = 300;

// ── GSC Search Analytics (DR-17 D4) ───────────────────────────────────────────

/** GSC `searchanalytics.query` rollup (totals + daily series + top queries/pages).
 * Cached per range; 6 h is the low end of plan §8's 6–12 h window — Search Console
 * data is daily-grained and lags ~2–3 days, so a sub-day cache buys nothing and
 * every miss is four engine API calls. */
export const SEO_ANALYTICS_CACHE_PREFIX = 'seo:analytics:';
export const SEO_ANALYTICS_TTL_SECONDS = 6 * 60 * 60;

/** Allowlisted lookback windows for the analytics endpoint. The cache key embeds
 * the range, and the DTO validates against this list (§3.5 — never interpolated). */
export const SEO_ANALYTICS_RANGES = ['7d', '28d', '90d'] as const;
export type SeoAnalyticsRange = (typeof SEO_ANALYTICS_RANGES)[number];

/** The plan's named window (plan §6/§9 — "28-day series"). */
export const SEO_ANALYTICS_DEFAULT_RANGE: SeoAnalyticsRange = '28d';

/** Range → lookback length in days. */
export const SEO_ANALYTICS_RANGE_DAYS: Record<SeoAnalyticsRange, number> = {
  '7d': 7,
  '28d': 28,
  '90d': 90,
};

/** Row cap for the top-queries / top-pages breakdowns (plan §6 — top-10). */
export const SEO_ANALYTICS_TOP_LIMIT = 10;

// ── Per-product URL Inspection (DR-17 D5) ─────────────────────────────────────

/** Per-URL GSC `urlInspection.index.inspect` result cache. URL Inspection is the
 * scarcest SEO resource (2 000/day per property), so it gets the longest read
 * cache (plan §8 — ≥24 h): a freshly-inspected URL is never re-spent within the
 * day. The daily-budget counter (`SEO_GSC_INSPECT_BUDGET_PREFIX`, declared in the
 * D3 block above) is the hard cap; this cache keeps us well under it. */
export const SEO_INSPECT_CACHE_PREFIX = 'seo:inspect:';
export const SEO_INSPECT_TTL_SECONDS = 24 * 60 * 60;

/** Read-side state for a single URL inspection. Distinct from `SeoEngineReadState`
 * (coverage/quota/analytics) because inspection adds `exhausted` — the daily 2 000
 * budget is spent, so we deliberately refuse rather than spend or error. */
export const SEO_URL_INSPECTION_STATES = ['ok', 'disabled', 'error', 'exhausted'] as const;
export type SeoUrlInspectionState = (typeof SEO_URL_INSPECTION_STATES)[number];

/** Slow URL-Inspection cache-warming sweep (plan §8/§10 D5). A scheduled job that
 * inspects the freshest active SKUs so an operator opening product-detail gets an
 * instant badge — NOT a new audit trail (inspection is not a submission). It runs
 * through the same budget-guarded `inspectUrl`, so a warm URL is free (cache hit,
 * no spend) and a sweep that hits the daily cap simply stops. */
export const SEO_URL_INSPECT_SWEEP_JOB = 'url-inspect-sweep';
/** Cron: daily 05:00 — ahead of the 06:00 sitemap regen + 06:30 health probe. */
export const SEO_URL_INSPECT_SWEEP_CRON = '0 5 * * *';
/** Top-N most-recently-updated active products inspected per sweep run. 100 × one
 * representative-locale URL each = ≤100 inspect calls/run, an order of magnitude
 * under the 2 000/day cap (plan §12 — never assume headroom; the counter enforces). */
export const SEO_URL_INSPECT_SWEEP_BATCH = 100;

// ── Sitemap ───────────────────────────────────────────────────────────────────

export const SITEMAP_BATCH_SIZE = 500;

/** Allowlist for redirect list sortBy */
export const VALID_REDIRECT_SORT_FIELDS = ['createdAt', 'updatedAt', 'fromPath'] as const;

// ── Locales ───────────────────────────────────────────────────────────────────

// The locales a store runs are runtime config (DR-31, plan E1.3). Every SEO
// surface reads them through these two functions, which return the snapshot
// the settings module keeps current, so a sitemap, a hreflang set or a feed
// built a second after an operator enables a locale already carries it.
export type SupportedLocale = CatalogueLocale;

export function supportedLocales(): readonly CatalogueLocale[] {
  return storeLocales.current().supportedLocales as readonly CatalogueLocale[];
}

export function defaultLocale(): CatalogueLocale {
  return storeLocales.current().defaultLocale as CatalogueLocale;
}

// ── AI crawlers (allowlist in robots.txt) ─────────────────────────────────────

// Source of truth: agent_docs/storefront/seo-geo.md "Crawler allowlist".
// The constant mirrors that block per constitution §3.14 single-source-of-truth.
// Drift in either direction is a §3.14 violation; updates land first in the doc,
// then here in the same /phase commit.
export const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Bingbot',
  'CCBot',
] as const;

// ── SEO health ────────────────────────────────────────────────────────────────

/** Max items returned per health-check category */
export const SEO_HEALTH_MAX_ITEMS = 50;
