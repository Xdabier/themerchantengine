import { ConfigService } from '@nestjs/config';
import { supportedLocales } from './seo.constants';
import { isProduction } from '@common/env';

const DEV_FALLBACK = 'http://localhost:53300';

/**
 * Single source of truth for the public storefront base URL the SEO + GEO
 * surfaces (sitemap*, llms.txt, robots.txt) emit into URL fields.
 *
 * Reads `STOREFRONT_PUBLIC_BASE_URL` first — that is the canonical env var the
 * production deploy template ships (`.env.production.example:51`,
 * `apps/storefront/.env.production.example:15`). Falls back to the legacy
 * `SITE_URL` so existing fixtures and the IndexNow / GSC submission paths
 * (which historically gated on `SITE_URL`) keep functioning.
 *
 * In production both unset is a configuration defect — the previous default
 * of `https://example.com` silently produced cross-origin sitemap URLs that
 * shipped to crawlers. Throwing here surfaces the misconfig at boot of the
 * cron processor instead of at crawler-fetch time.
 */
export function resolvePublicBaseUrl(config: ConfigService): string {
  const url = config.get<string>('STOREFRONT_PUBLIC_BASE_URL') ?? config.get<string>('SITE_URL');
  if (url) return url.replace(/\/$/, '');
  if (isProduction()) {
    throw new Error(
      'STOREFRONT_PUBLIC_BASE_URL must be set in production (legacy SITE_URL also accepted).',
    );
  }
  return DEV_FALLBACK;
}

/**
 * Builds the locale-prefixed Analog route path for an entity. Source of truth:
 * apps/storefront/src/app/pages/[locale]/catalog/{[slug].page.ts,product/[slug].page.ts}.
 * Sitemap, canonical, JSON-LD, AND the manual reindex submit (DR-17) all derive
 * their URLs from this single shape so a manual submit can never drift from the
 * locale-prefix the sitemap advertises (§3.14 single source of truth).
 */
export function entityPath(
  entityType: 'product' | 'category' | 'page',
  slug: string,
  locale: string,
): string {
  switch (entityType) {
    case 'product':
      return `/${locale}/catalog/product/${slug}`;
    case 'category':
      return `/${locale}/catalog/${slug}`;
    case 'page':
      // Mirrors apps/storefront/src/app/pages/[locale]/pages/[slug].page.ts.
      // CMS slugs are stored slash-prefixed, and interpolating that raw used
      // to emit `/en//about`, a double-slash 404.
      return `/${locale}/pages/${slug.replace(/^\/+|\/+$/g, '')}`;
  }
}

/**
 * Every supported-locale absolute product URL for a slug, e.g.
 * `['https://host/en/catalog/product/widget', 'https://host/fr/catalog/product/widget']`.
 * The IndexNow submit advertises all locale variants of a changed product.
 */
export function localeProductUrls(siteUrl: string, slug: string): string[] {
  const base = siteUrl.replace(/\/$/, '');
  return supportedLocales().map((locale) => `${base}${entityPath('product', slug, locale)}`);
}
