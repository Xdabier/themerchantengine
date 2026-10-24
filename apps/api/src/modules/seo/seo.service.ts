import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { Prisma, ProductStatus, RedirectType, ReviewStatus } from '@prisma/client';
import { tryPickVariantUrl } from '@common/asset-variants';
// The three-rung Translatable chain (§02), imported rather than re-derived.
// This file carried its own two-rung copy that skipped the `en` rung, so the
// same row resolved differently here than through the global interceptor.
import { resolveTranslatable } from '@common/interceptors';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AI_CRAWLERS,
  SEO_HEALTH_MAX_ITEMS,
  SEO_REDIRECTS_DEFAULT_PAGE_SIZE,
  SEO_REDIS_CLIENT,
  SEO_ROBOTS_CACHE_KEY,
  SEO_ROBOTS_TTL_SECONDS,
  SEO_SITEMAP_CATEGORIES_CACHE_KEY,
  SEO_SITEMAP_INDEX_CACHE_KEY,
  SEO_SITEMAP_JOB,
  SEO_SITEMAP_PAGES_CACHE_KEY,
  SEO_SITEMAP_PRODUCTS_CACHE_KEY,
  SEO_SITEMAP_QUEUE,
  SEO_SETTINGS_SERVICE,
  SEO_SITEMAP_TTL_SECONDS,
  SEO_SUBMISSION_HEALTH_CACHE_KEY,
  SEO_SUBMISSION_HEALTH_TTL_SECONDS,
  SITEMAP_BATCH_SIZE,
  defaultLocale,
  supportedLocales,
} from './seo.constants';
import type { SubmissionHealth } from './search-engine-submit.service';
import { regionFromLocale } from './locale-region';
import { CurrenciesService } from '../currencies/currencies.service';
import { entityPath } from './site-url';
import type { CreateRedirectAdminDto, ListRedirectsAdminDto } from './dto';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MetaTag {
  title: string;
  description: string;
  canonical: string;
  hreflang: Array<{ locale: string; url: string }>;
  og: { title: string; description: string; url: string; type: string };
  twitter: { card: string; title: string; description: string };
}

export interface SchemaMarkup {
  '@context': string;
  '@type': string | string[];
  [key: string]: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** '' for anything that is not a non-blank string, so an unsupplied DR-29
 * value is omitted from JSON-LD rather than emitted as an empty property. */
function asNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : '';
}

/**
 * Narrow read seam onto SettingsService (§3.1): the SEO module never touches
 * another module's Prisma client, and this interface is what the
 * SEO_SETTINGS_SERVICE token resolves to for the purposes of this file.
 */
export interface SeoSettingsReader {
  get<T = unknown>(key: string): Promise<T>;
  getGroup(group: 'business' | 'appearance'): Promise<Record<string, unknown>>;
}

/**
 * The schema.org `Organization.logo` URL from the runtime config: the
 * operator's `appearance.logoUrl`, absolute as given or site-relative resolved
 * against the public base URL. Empty means no logo claim at all: an absent
 * property is merely incomplete, a URL that 404s is a rich-results defect.
 * The asset-backed `brand.logoAssetId` joins this once the storefront serves
 * the brand asset (plan E2.2).
 */
function organizationLogoUrl(siteUrl: string, logoUrl: unknown): string | undefined {
  if (typeof logoUrl !== 'string' || !logoUrl.trim()) return undefined;
  const value = logoUrl.trim();
  if (/^https?:\/\//i.test(value)) return value;
  return `${siteUrl.replace(/\/$/, '')}/${value.replace(/^\//, '')}`;
}

// The region tail moved to ./locale-region.ts in S24.7 once a
// third consumer landed (seo.ts on the storefront, seo.service.ts here, plus
// the storefront e2e parity assertion). Source of truth:
// agent_docs/storefront/seo-geo.md "## OG locale convention".

/**
 * Emits the three `<xhtml:link rel="alternate" hreflang>` siblings for a sitemap
 * `<url>` entry: one per supported locale plus `x-default` falling back to the
 * default locale, `defaultLocale()` (matches the storefront precedent at
 * apps/storefront/src/lib/seo.ts).
 */
function hreflangAlternates(
  siteUrl: string,
  basePath: (locale: string) => string,
  region: (locale: string) => string,
): string {
  const lines = supportedLocales().map(
    (loc) =>
      `<xhtml:link rel="alternate" hreflang="${region(loc)}" href="${xmlEscape(
        `${siteUrl}${basePath(loc)}`,
      )}"/>`,
  );
  lines.push(
    `<xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(
      `${siteUrl}${basePath(defaultLocale())}`,
    )}"/>`,
  );
  return lines.join('');
}

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Browsers fall back to `display: inline` rendering for XML that mixes the
// XHTML namespace into a non-HTML root (sitemap `<urlset>` + `<xhtml:link>`
// hreflang siblings), collapsing the document into a wall of concatenated
// text. Pointing every sitemap response at a storefront-hosted XSLT restores
// a readable HTML table when a human opens the URL in a browser; crawlers
// (Googlebot, Bingbot, IndexNow) ignore the PI and continue to read the raw
// XML. Authority: `docs/storefront-api-reference.md` §SEO sitemap surfaces
// (rendered output is browser-only; raw payload is unchanged); the stylesheet
// takes its colours from the storefront's runtime palette.
const SITEMAP_STYLESHEET_PI = '<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>';

const URLSET_OPEN =
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">';

// The products sitemap additionally declares the Google image-sitemap namespace so each
// product <url> can carry an <image:image> for its primary photo. Per the image-sitemap
// spec, image URLs may live on a different host (the S3 asset bucket). Full Google
// attribution of those images requires verifying that host in Search Console; see
// agent_docs/storefront/seo-geo.md "## Search-engine submission" + [DR-15].
const URLSET_OPEN_WITH_IMAGE =
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">';

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class SeoService {
  private readonly logger = new Logger(SeoService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SEO_REDIS_CLIENT) private readonly redis: Redis,
    @InjectQueue(SEO_SITEMAP_QUEUE) private readonly sitemapQueue: Queue,
    // The token is already provided by seo.module.ts and already consumed by
    // SeoStorefrontController. The homepage schema was the one builder that
    // invented its identity instead of reading it.
    @Inject(SEO_SETTINGS_SERVICE) private readonly settings: SeoSettingsReader,
    // The Offer currency is the live store currency (DR-31), never a literal.
    private readonly currencies: CurrenciesService,
  ) {}

  /**
   * The hreflang region tail is the store's country (plan E1.3.6): read once
   * per document, applied to every locale of it.
   */
  private async regionTagger(): Promise<(locale: string) => string> {
    const business = await this.settings.getGroup('business');
    const country = asNonEmptyString(business['addressCountry']);
    return (locale) => regionFromLocale(locale, country);
  }

  // ── Meta Tags ───────────────────────────────────────────────────────────────

  /**
   * Generates meta tags for a product, category, page, or homepage.
   * Uses entity's metaTitle/metaDescription when available, falling back to
   * name/description. Includes OG, Twitter, and hreflang alternates.
   */
  async generateMetaTags(
    entityType: 'product' | 'category' | 'page' | 'homepage',
    entityId: string | null,
    locale: string,
    siteUrl: string,
  ): Promise<MetaTag> {
    let rawTitle = '';
    let rawDescription = '';
    let path = '/';

    if (entityType === 'product' && entityId) {
      const product = await this.prisma.product.findUnique({
        where: { id: entityId },
        select: {
          name: true,
          description: true,
          metaTitle: true,
          metaDescription: true,
          slug: true,
        },
      });
      if (!product) throw new NotFoundException('Product not found');
      rawTitle = resolveTranslatable(product.metaTitle ?? product.name, locale);
      rawDescription = resolveTranslatable(product.metaDescription ?? product.description, locale);
      path = entityPath('product', product.slug, locale);
    } else if (entityType === 'category' && entityId) {
      const category = await this.prisma.category.findUnique({
        where: { id: entityId },
        select: {
          name: true,
          description: true,
          metaTitle: true,
          metaDescription: true,
          slug: true,
        },
      });
      if (!category) throw new NotFoundException('Category not found');
      rawTitle = resolveTranslatable(category.metaTitle ?? category.name, locale);
      rawDescription = resolveTranslatable(
        category.metaDescription ?? category.description,
        locale,
      );
      path = entityPath('category', category.slug, locale);
    } else if (entityType === 'page' && entityId) {
      const page = await this.prisma.cmsPage.findUnique({
        where: { id: entityId },
        select: { title: true, content: true, metaTitle: true, metaDescription: true, slug: true },
      });
      if (!page) throw new NotFoundException('Page not found');
      rawTitle = resolveTranslatable(page.metaTitle ?? page.title, locale);
      rawDescription = resolveTranslatable(page.metaDescription ?? page.content, locale);
      path = entityPath('page', page.slug, locale);
    }

    const canonical = `${siteUrl}${path}`;

    // Hreflang alternates: one URL per supported locale, plus x-default falling
    // back to `fr` (the storefront default). Each URL is the locale-prefixed
    // entity path per the live Analog routes. The .locale field carries the
    // regional code (`fr-TN`, `en-TN`, `x-default`) per
    // agent_docs/storefront/seo-geo.md "Hreflang regional codes".
    const slugLastSegment = path.split('/').pop() ?? '';
    const region = await this.regionTagger();
    const hreflang: Array<{ locale: string; url: string }> =
      entityType === 'homepage'
        ? supportedLocales().map((loc) => ({
            locale: region(loc),
            url: `${siteUrl}/${loc}`,
          }))
        : supportedLocales().map((loc) => ({
            locale: region(loc),
            url: `${siteUrl}${entityPath(entityType, slugLastSegment, loc)}`,
          }));
    hreflang.push({
      locale: 'x-default',
      url:
        entityType === 'homepage'
          ? `${siteUrl}/${defaultLocale()}`
          : `${siteUrl}${entityPath(entityType, slugLastSegment, defaultLocale())}`,
    });

    return {
      title: rawTitle,
      description: rawDescription.slice(0, 160),
      canonical,
      hreflang,
      og: {
        title: rawTitle,
        description: rawDescription.slice(0, 160),
        url: canonical,
        type: entityType === 'product' ? 'product' : 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title: rawTitle,
        description: rawDescription.slice(0, 160),
      },
    };
  }

  // ── Schema.org JSON-LD ──────────────────────────────────────────────────────

  /**
   * Generates Schema.org JSON-LD markup for a product, category, or homepage.
   * - Product: Product + Offer + AggregateRating + BreadcrumbList
   * - Category: CollectionPage + BreadcrumbList
   * - Homepage: Organization + WebSite + SearchAction
   */
  async generateSchemaMarkup(
    entityType: 'product' | 'category' | 'homepage',
    entityId: string | null,
    siteUrl: string,
    locale: string = defaultLocale(),
  ): Promise<SchemaMarkup[]> {
    if (entityType === 'product' && entityId) {
      return this.buildProductSchema(entityId, siteUrl, locale);
    }
    if (entityType === 'category' && entityId) {
      return this.buildCategorySchema(entityId, siteUrl);
    }
    return this.buildHomepageSchema(siteUrl, locale);
  }

  private async buildProductSchema(
    productId: string,
    siteUrl: string,
    locale: string = defaultLocale(),
  ): Promise<SchemaMarkup[]> {
    const storeCurrency = await this.currencies.getStore();
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        name: true,
        description: true,
        slug: true,
        // S24.6 enrichment per DR-09 product rich-results.
        brand: true, // legacy free-text — backwards-compat fallback when brandId IS NULL
        brandId: true,
        gtin: true,
        mpn: true,
        brandRelation: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    const [firstVariant, approvedReviews, firstProductCategory] = await Promise.all([
      this.prisma.productVariant.findFirst({
        where: { productId, deletedAt: null },
        select: { price: true, sku: true }, // S24.6: sku surfaced to JSON-LD
        orderBy: { isDefault: 'desc' },
      }),
      this.prisma.review.findMany({
        where: { productId, status: ReviewStatus.PUBLISHED },
        select: { rating: true },
      }),
      this.prisma.productCategory.findFirst({
        where: { productId },
        select: { category: { select: { name: true, slug: true } } },
      }),
    ]);

    const name = resolveTranslatable(product.name, locale);
    const description = resolveTranslatable(product.description, locale);
    // JSON-LD URL matches the live Analog route + canonical emitted in
    // generateMetaTags. Locale-prefix per the corrected sitemap shape from S23.4.
    const url = `${siteUrl}${entityPath('product', product.slug, locale)}`;
    const price = firstVariant?.price ?? 0;

    const ratings: number[] = approvedReviews.map((r) => r.rating);
    const avgRating =
      ratings.length > 0
        ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length
        : null;

    // S24.6 brand resolution per DR-09: prefer the linked Brand FK, fall back to the
    // deprecated free-text Product.brand column when brandId IS NULL (legacy products
    // whose backfill lost the slug-normalization race; they keep brand attribution
    // until the S25 admin Brand CRUD UI lets the operator dedupe collision survivors).
    const brand = product.brandRelation
      ? { '@type': 'Brand', name: resolveTranslatable(product.brandRelation.name, locale) }
      : product.brand && product.brand.trim() !== ''
        ? { '@type': 'Brand', name: product.brand }
        : undefined;

    const productSchema: SchemaMarkup = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name,
      description,
      url,
      ...(brand && { brand }),
      ...(firstVariant?.sku && { sku: firstVariant.sku }),
      ...(product.gtin && { gtin: product.gtin }),
      ...(product.mpn && { mpn: product.mpn }),
      // S24.6: itemCondition default per DR-09 §"Decision". Out of S24 scope: a
      // SettingsService-driven override (e.g. UsedCondition for second-hand variants).
      itemCondition: 'https://schema.org/NewCondition',
      offers: {
        '@type': 'Offer',
        price: Number(price),
        // The store currency from the currencies module: a literal here once
        // served Google a wrong-currency rich result on every product.
        priceCurrency: storeCurrency.code,
        availability: 'https://schema.org/InStock',
        url,
      },
      ...(avgRating !== null && {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: Math.round(avgRating * 10) / 10,
          reviewCount: ratings.length,
        },
      }),
    };

    const breadcrumb: SchemaMarkup = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        // S24.6: Home item carries the locale prefix matching the corrected sitemap
        // shape from S23.4 — every BreadcrumbList item URL begins with /${locale}.
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl}/${locale}` },
        ...(firstProductCategory
          ? [
              {
                '@type': 'ListItem',
                position: 2,
                name: resolveTranslatable(firstProductCategory.category.name, locale),
                item: `${siteUrl}${entityPath('category', firstProductCategory.category.slug, locale)}`,
              },
            ]
          : []),
        { '@type': 'ListItem', position: firstProductCategory ? 3 : 2, name, item: url },
      ],
    };

    return [productSchema, breadcrumb];
  }

  private async buildCategorySchema(categoryId: string, siteUrl: string): Promise<SchemaMarkup[]> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { name: true, description: true, slug: true, parentId: true },
    });
    if (!category) throw new NotFoundException('Category not found');

    const parent = category.parentId
      ? await this.prisma.category.findUnique({
          where: { id: category.parentId },
          select: { name: true, slug: true },
        })
      : null;

    // The JSON-LD names must resolve in the same locale the emitted `url`
    // points at, or the block advertises a French URL describing English text.
    // Both derive from `defaultLocale()`, the store's default locale.
    const schemaLocale = defaultLocale();
    const name = resolveTranslatable(category.name, schemaLocale);
    const description = resolveTranslatable(category.description, schemaLocale);
    const url = `${siteUrl}${entityPath('category', category.slug, schemaLocale)}`;

    const collectionPage: SchemaMarkup = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name,
      description,
      url,
    };

    const breadcrumb: SchemaMarkup = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
        ...(parent
          ? [
              {
                '@type': 'ListItem',
                position: 2,
                name: resolveTranslatable(parent.name, schemaLocale),
                item: `${siteUrl}${entityPath('category', parent.slug, schemaLocale)}`,
              },
            ]
          : []),
        { '@type': 'ListItem', position: parent ? 3 : 2, name, item: url },
      ],
    };

    return [collectionPage, breadcrumb];
  }

  private async buildHomepageSchema(siteUrl: string, locale: string): Promise<SchemaMarkup[]> {
    // Was a literal `name: 'Store'` with no address, areaServed, or logo, so
    // the homepage advertised a nameless business to every crawler and to
    // every AI layer that reads JSON-LD. The values come from the DR-29
    // `business` group now. Values the operator has not supplied are OMITTED
    // rather than emitted empty: an empty `addressLocality` is a rich-results
    // defect, while an absent one is merely incomplete.
    const [storeName, business, appearance] = await Promise.all([
      this.settings.get<Record<string, string> | string>('storeName'),
      this.settings.getGroup('business'),
      this.settings.getGroup('appearance'),
    ]);
    const logo = organizationLogoUrl(siteUrl, appearance['logoUrl']);

    const streetAddress = resolveTranslatable(business['streetAddress'], locale);
    const addressLocality = asNonEmptyString(business['addressLocality']);
    const addressCountry = asNonEmptyString(business['addressCountry']);
    const telephone = asNonEmptyString(business['telephone']);
    const areaServed = Array.isArray(business['areaServed'])
      ? (business['areaServed'] as unknown[]).filter(
          (code): code is string => typeof code === 'string' && code.trim() !== '',
        )
      : [];

    const address: Record<string, string> = { '@type': 'PostalAddress' };
    if (streetAddress) address['streetAddress'] = streetAddress;
    if (addressLocality) address['addressLocality'] = addressLocality;
    if (addressCountry) address['addressCountry'] = addressCountry;

    const org: SchemaMarkup = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      url: siteUrl,
      name: resolveTranslatable(storeName, locale),
      ...(logo && { logo }),
      ...(Object.keys(address).length > 1 && { address }),
      ...(areaServed.length > 0 && { areaServed }),
      ...(telephone && { telephone }),
    };

    const website: SchemaMarkup = {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      url: siteUrl,
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${siteUrl}/search?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    };

    return [org, website];
  }

  // ── Sitemap generation ──────────────────────────────────────────────────────

  /** Enqueue a sitemap regeneration job (called by listener on entity changes). */
  async enqueueSitemapRegeneration(): Promise<void> {
    await this.sitemapQueue.add(SEO_SITEMAP_JOB, {}, { jobId: 'sitemap-generate' });
  }

  /**
   * Generates all sitemaps and stores them in Redis.
   * Called by BullMQ processor (cron + event-triggered).
   */
  async regenerateSitemaps(siteUrl: string): Promise<void> {
    const [productXml, categoryXml, pageXml, lastmods] = await Promise.all([
      this.buildProductsSitemap(siteUrl),
      this.buildCategoriesSitemap(siteUrl),
      this.buildPagesSitemap(siteUrl),
      this.computeChildLastmods(),
    ]);

    const indexXml = this.buildSitemapIndex(siteUrl, lastmods);

    await Promise.all([
      this.redis.setex(SEO_SITEMAP_INDEX_CACHE_KEY, SEO_SITEMAP_TTL_SECONDS, indexXml),
      this.redis.setex(SEO_SITEMAP_PRODUCTS_CACHE_KEY, SEO_SITEMAP_TTL_SECONDS, productXml),
      this.redis.setex(SEO_SITEMAP_CATEGORIES_CACHE_KEY, SEO_SITEMAP_TTL_SECONDS, categoryXml),
      this.redis.setex(SEO_SITEMAP_PAGES_CACHE_KEY, SEO_SITEMAP_TTL_SECONDS, pageXml),
    ]);

    this.logger.log('regenerateSitemaps: all sitemaps updated in Redis');
  }

  /** Get sitemap index XML from cache, regenerating if stale. */
  async getSitemapIndex(siteUrl: string): Promise<string> {
    const cached = await this.redis.get(SEO_SITEMAP_INDEX_CACHE_KEY);
    if (cached) return cached;
    await this.regenerateSitemaps(siteUrl);
    return (await this.redis.get(SEO_SITEMAP_INDEX_CACHE_KEY)) ?? this.buildSitemapIndex(siteUrl);
  }

  /** Get products sitemap XML from cache. */
  async getProductsSitemap(siteUrl: string): Promise<string> {
    const cached = await this.redis.get(SEO_SITEMAP_PRODUCTS_CACHE_KEY);
    if (cached) return cached;
    const xml = await this.buildProductsSitemap(siteUrl);
    await this.redis.setex(SEO_SITEMAP_PRODUCTS_CACHE_KEY, SEO_SITEMAP_TTL_SECONDS, xml);
    return xml;
  }

  /** Get categories sitemap XML from cache. */
  async getCategoriesSitemap(siteUrl: string): Promise<string> {
    const cached = await this.redis.get(SEO_SITEMAP_CATEGORIES_CACHE_KEY);
    if (cached) return cached;
    const xml = await this.buildCategoriesSitemap(siteUrl);
    await this.redis.setex(SEO_SITEMAP_CATEGORIES_CACHE_KEY, SEO_SITEMAP_TTL_SECONDS, xml);
    return xml;
  }

  /** Get pages sitemap XML from cache (CMS pages + static about/policies). */
  async getPagesSitemap(siteUrl: string): Promise<string> {
    const cached = await this.redis.get(SEO_SITEMAP_PAGES_CACHE_KEY);
    if (cached) return cached;
    const xml = await this.buildPagesSitemap(siteUrl);
    await this.redis.setex(SEO_SITEMAP_PAGES_CACHE_KEY, SEO_SITEMAP_TTL_SECONDS, xml);
    return xml;
  }

  private buildSitemapIndex(
    siteUrl: string,
    lastmods?: { products?: string; categories?: string; pages?: string },
  ): string {
    const entry = (file: string, lastmod?: string): string =>
      `  <sitemap><loc>${xmlEscape(siteUrl)}/${file}</loc>` +
      (lastmod ? `<lastmod>${lastmod}</lastmod>` : '') +
      `</sitemap>`;
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      SITEMAP_STYLESHEET_PI,
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      entry('sitemap-products.xml', lastmods?.products),
      entry('sitemap-categories.xml', lastmods?.categories),
      entry('sitemap-pages.xml', lastmods?.pages),
      '</sitemapindex>',
    ].join('\n');
  }

  /**
   * Computes each child sitemap's <lastmod> as the max real content-change timestamp of
   * the rows it lists — NOT the regen wall-clock. An always-"now" index lastmod is the
   * anti-pattern Bing explicitly distrusts, and Google only honours lastmod when it is
   * verifiably accurate. Returns undefined per child when it has no dated rows; the
   * index then omits that child's optional <lastmod>. Per [DR-15] +
   * agent_docs/storefront/seo-geo.md "## Sitemap".
   */
  private async computeChildLastmods(): Promise<{
    products?: string;
    categories?: string;
    pages?: string;
  }> {
    const [products, categories, pages] = await Promise.all([
      this.prisma.product.aggregate({
        _max: { updatedAt: true },
        where: { deletedAt: null, status: ProductStatus.ACTIVE },
      }),
      this.prisma.category.aggregate({
        _max: { updatedAt: true },
        where: { deletedAt: null, isVisible: true },
      }),
      this.prisma.cmsPage.aggregate({
        _max: { updatedAt: true },
        where: { isPublished: true, deletedAt: null },
      }),
    ]);
    return {
      products: products._max.updatedAt?.toISOString(),
      categories: categories._max.updatedAt?.toISOString(),
      pages: pages._max.updatedAt?.toISOString(),
    };
  }

  private async buildProductsSitemap(siteUrl: string): Promise<string> {
    const region = await this.regionTagger();
    const urls: string[] = [];
    let cursor = 0;

    while (true) {
      const batch = await this.prisma.product.findMany({
        // Only canonical, indexable URLs belong in a sitemap: ACTIVE + not soft-deleted
        // mirrors the storefront product read filter (products.service.ts:184/:311), so
        // DRAFT / ARCHIVED products — which 404 or noindex on the storefront — are excluded.
        where: { deletedAt: null, status: ProductStatus.ACTIVE },
        select: {
          slug: true,
          updatedAt: true,
          // Primary product photo for the <image:image> extension (F06). isPrimary first,
          // then sortOrder — same precedence as the storefront product projection.
          assets: {
            orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
            take: 1,
            select: { asset: { select: { id: true, status: true, variants: true } } },
          },
        },
        orderBy: { id: 'asc' },
        skip: cursor,
        take: SITEMAP_BATCH_SIZE,
      });
      if (batch.length === 0) break;

      for (const p of batch) {
        const lastmod = p.updatedAt.toISOString();
        const alternates = hreflangAlternates(
          siteUrl,
          (loc) => entityPath('product', p.slug, loc),
          region,
        );
        // The primary image is locale-agnostic — resolve once per product. The resolver
        // returns the canonical 'detail' variant URL (the same URL the product page emits
        // as og:image) so Google associates the sitemap image with the on-page image.
        const primaryAsset = p.assets[0]?.asset;
        const imageUrl = primaryAsset ? tryPickVariantUrl(primaryAsset, 'detail')?.url : null;
        const imageTag = imageUrl
          ? `<image:image><image:loc>${xmlEscape(imageUrl)}</image:loc></image:image>`
          : '';
        for (const loc of supportedLocales()) {
          urls.push(
            `  <url><loc>${xmlEscape(`${siteUrl}${entityPath('product', p.slug, loc)}`)}</loc>` +
              `<lastmod>${lastmod}</lastmod>` +
              `<changefreq>weekly</changefreq><priority>0.8</priority>` +
              alternates +
              imageTag +
              `</url>`,
          );
        }
      }
      cursor += batch.length;
      if (batch.length < SITEMAP_BATCH_SIZE) break;
    }

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      SITEMAP_STYLESHEET_PI,
      URLSET_OPEN_WITH_IMAGE,
      ...urls,
      '</urlset>',
    ].join('\n');
  }

  private async buildCategoriesSitemap(siteUrl: string): Promise<string> {
    const region = await this.regionTagger();
    const categories = await this.prisma.category.findMany({
      where: { deletedAt: null, isVisible: true },
      select: { slug: true, updatedAt: true },
      orderBy: { sortOrder: 'asc' },
    });

    const urls: string[] = [];
    for (const c of categories) {
      const lastmod = c.updatedAt.toISOString();
      const alternates = hreflangAlternates(
        siteUrl,
        (loc) => entityPath('category', c.slug, loc),
        region,
      );
      for (const loc of supportedLocales()) {
        urls.push(
          `  <url><loc>${xmlEscape(`${siteUrl}${entityPath('category', c.slug, loc)}`)}</loc>` +
            `<lastmod>${lastmod}</lastmod>` +
            `<changefreq>weekly</changefreq><priority>0.7</priority>` +
            alternates +
            `</url>`,
        );
      }
    }

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      SITEMAP_STYLESHEET_PI,
      URLSET_OPEN,
      ...urls,
      '</urlset>',
    ].join('\n');
  }

  private async buildPagesSitemap(siteUrl: string): Promise<string> {
    const region = await this.regionTagger();
    const pages = await this.prisma.cmsPage.findMany({
      where: { isPublished: true, deletedAt: null },
      select: { slug: true, updatedAt: true },
      orderBy: { slug: 'asc' },
    });

    // Static SSG pages shipped by the storefront (about + policies). These
    // do not live in CmsPage; the storefront ships them as code-resident
    // copy. Path values are stored slash-prefixed; the dedup set strips the
    // leading slash so we can compare against normalized CMS slugs.
    const staticPaths = [
      '/about',
      '/policies/privacy',
      '/policies/returns',
      '/policies/terms',
      '/policies/shipping',
    ];
    const staticSlugSet = new Set(staticPaths.map((p) => p.replace(/^\/+/, '')));

    // The CMS slugs that resolve to those static paths rather than to the
    // generic /{locale}/pages/{slug} route. Three of the five do not match
    // their storefront slug, so a set built from `staticPaths` alone missed
    // them and the sitemap advertised four soft 404s per locale. Mirrors
    // LEGACY_CMS_SLUGS in apps/storefront/src/lib/routes.ts; a cross-app
    // import is impossible, and the seo journey's sitemap-200 sweep is the
    // guard that catches drift on either side.
    const legacyCmsSlugs = new Set([
      'about',
      'privacy-policy',
      'return-policy',
      'terms',
      'shipping-info',
    ]);

    // CMS-driven pages: emit per-locale URLs at /{locale}/pages/{slug}, the
    // generic route the storefront serves. Each entry carries the
    // hreflang alternate set per agent_docs/storefront/seo-geo.md "Hreflang
    // regional codes".
    //
    // Slug normalization: prod data shipped CMS rows with leading slashes
    // (slug = "/about"), which `entityPath('page', slug, locale)` turned into
    // `/en//about` — a double-slash 404 in Analog. Strip leading/trailing
    // slashes before interpolation. Then dedup against `staticSlugSet`: when
    // a CMS row collides with a code-resident static page, the static page
    // wins (it carries the canonical content and the storefront's <lastmod>
    // is irrelevant for those routes).
    const cmsUrls: string[] = [];
    for (const p of pages) {
      const normalizedSlug = p.slug.replace(/^\/+|\/+$/g, '');
      if (!normalizedSlug) continue;
      if (staticSlugSet.has(normalizedSlug)) continue;
      if (legacyCmsSlugs.has(normalizedSlug)) continue;

      // The generic route is `[slug]`, one segment. Advertising a deeper slug
      // would put a URL nothing serves back into the sitemap.
      if (normalizedSlug.includes('/')) {
        this.logger.warn(
          `buildPagesSitemap: skipping multi-segment CMS slug "${p.slug}" — ` +
            'the storefront route /{locale}/pages/{slug} matches one segment only',
        );
        continue;
      }

      const lastmod = p.updatedAt.toISOString();
      const alternates = hreflangAlternates(
        siteUrl,
        (loc) => entityPath('page', normalizedSlug, loc),
        region,
      );
      for (const loc of supportedLocales()) {
        cmsUrls.push(
          `  <url><loc>${xmlEscape(`${siteUrl}${entityPath('page', normalizedSlug, loc)}`)}</loc>` +
            `<lastmod>${lastmod}</lastmod>` +
            `<changefreq>monthly</changefreq><priority>0.5</priority>` +
            alternates +
            `</url>`,
        );
      }
    }

    const staticUrls = staticPaths.flatMap((path) => {
      const alternates = hreflangAlternates(siteUrl, (loc) => `/${loc}${path}`, region);
      return supportedLocales().map(
        (locale) =>
          `  <url><loc>${xmlEscape(`${siteUrl}/${locale}${path}`)}</loc>` +
          `<changefreq>yearly</changefreq><priority>0.3</priority>` +
          alternates +
          `</url>`,
      );
    });

    // Core hub pages: the homepage and the catalog landing. Both are fully indexable
    // (complete SSR meta + JSON-LD) and are the highest-authority entry points, so they
    // belong in the sitemap (F02). Mirror each page's exact canonical: the homepage
    // canonical carries a trailing slash (/en/, /fr/), the catalog landing does not
    // (/en/catalog). x-default falls back to `fr` via hreflangAlternates.
    const corePages: Array<{
      basePath: (loc: string) => string;
      changefreq: string;
      priority: string;
    }> = [
      { basePath: (loc) => `/${loc}/`, changefreq: 'daily', priority: '1.0' },
      { basePath: (loc) => `/${loc}/catalog`, changefreq: 'daily', priority: '0.9' },
    ];
    const coreUrls = corePages.flatMap((cp) => {
      const alternates = hreflangAlternates(siteUrl, cp.basePath, region);
      return supportedLocales().map(
        (locale) =>
          `  <url><loc>${xmlEscape(`${siteUrl}${cp.basePath(locale)}`)}</loc>` +
          `<changefreq>${cp.changefreq}</changefreq><priority>${cp.priority}</priority>` +
          alternates +
          `</url>`,
      );
    });

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      SITEMAP_STYLESHEET_PI,
      URLSET_OPEN,
      ...coreUrls,
      ...cmsUrls,
      ...staticUrls,
      '</urlset>',
    ].join('\n');
  }

  // ── Robots.txt ──────────────────────────────────────────────────────────────

  /**
   * Returns robots.txt content.
   * Cached 1 hour. AI crawlers are explicitly allowed per
   * agent_docs/storefront/seo-geo.md "Crawler allowlist" — the doc-of-record
   * for both the bot roster and the Allow-vs-Disallow direction.
   */
  async getRobotsTxt(siteUrl: string): Promise<string> {
    const cached = await this.redis.get(SEO_ROBOTS_CACHE_KEY);
    if (cached) return cached;

    const lines: string[] = [
      `# AI content guide: ${siteUrl}/llms.txt`,
      '',
      'User-agent: *',
      'Allow: /',
      'Disallow: /v1/admin/',
      'Disallow: /v1/auth/',
      'Disallow: /checkout',
      'Disallow: /account',
      'Disallow: /cart',
      // Faceted-search query strings carry no SEO equity and waste crawl
      // budget; the canonical results live behind /catalog/ category pages.
      'Disallow: /search?',
      '',
    ];

    for (const bot of AI_CRAWLERS) {
      lines.push(`User-agent: ${bot}`, 'Allow: /', '');
    }

    lines.push(`Sitemap: ${siteUrl}/sitemap_index.xml`);

    const content = lines.join('\n');
    await this.redis.setex(SEO_ROBOTS_CACHE_KEY, SEO_ROBOTS_TTL_SECONDS, content);
    return content;
  }

  // ── Redirects ───────────────────────────────────────────────────────────────

  /** List redirects with pagination, optional isAutoGenerated filter, search. */
  async listRedirects(dto: ListRedirectsAdminDto) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? SEO_REDIRECTS_DEFAULT_PAGE_SIZE;
    const skip = (page - 1) * pageSize;
    const sortBy = dto.sortBy ?? 'createdAt';
    const sortOrder = dto.sortOrder ?? 'desc';

    const where: Record<string, unknown> = {};
    if (dto.isAutoGenerated !== undefined) where['isAutoGenerated'] = dto.isAutoGenerated;
    if (dto.search) where['fromPath'] = { contains: dto.search, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.seoRedirect.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.seoRedirect.count({ where }),
    ]);

    return { data: items, meta: { page, pageSize, total } };
  }

  /** Manually create a redirect. Rejects if fromPath already exists. */
  async createRedirect(dto: CreateRedirectAdminDto) {
    const existing = await this.prisma.seoRedirect.findUnique({
      where: { fromPath: dto.fromPath },
    });
    if (existing) {
      throw new ConflictException(`Redirect from '${dto.fromPath}' already exists`);
    }

    return this.prisma.seoRedirect.create({
      data: {
        fromPath: dto.fromPath,
        toPath: dto.toPath,
        type: dto.type ?? RedirectType.MOVED_PERMANENTLY,
        isAutoGenerated: false,
      },
    });
  }

  /** Delete a redirect by ID. */
  async deleteRedirect(id: string): Promise<void> {
    const existing = await this.prisma.seoRedirect.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Redirect not found');
    await this.prisma.seoRedirect.delete({ where: { id } });
  }

  /**
   * Resolve a redirect for the given path.
   * Returns `{ toPath, type }` or `null` if no redirect exists.
   */
  /**
   * Every non-deleted redirect, flattened for the storefront edge.
   *
   * `permanent` rather than the raw enum so the consumer does not have to know
   * Prisma's `RedirectType`, and so a new enum member cannot silently change
   * the status code an edge emits.
   */
  async listActiveRedirects(): Promise<{ fromPath: string; toPath: string; permanent: boolean }[]> {
    const rows = await this.prisma.seoRedirect.findMany({
      select: { fromPath: true, toPath: true, type: true },
      orderBy: { fromPath: 'asc' },
    });
    return rows.map((row) => ({
      fromPath: row.fromPath,
      toPath: row.toPath,
      permanent: row.type === RedirectType.MOVED_PERMANENTLY,
    }));
  }

  async resolveRedirect(fromPath: string): Promise<{ toPath: string; type: RedirectType } | null> {
    const redirect = await this.prisma.seoRedirect.findUnique({
      where: { fromPath },
      select: { toPath: true, type: true },
    });
    return redirect ?? null;
  }

  /**
   * Upsert an auto-generated 301 redirect.
   * If a redirect from `fromPath` already exists, updates its toPath.
   * Called by the slug-change listener.
   */
  async upsertAutoRedirect(fromPath: string, toPath: string): Promise<void> {
    await this.prisma.seoRedirect.upsert({
      where: { fromPath },
      update: { toPath, updatedAt: new Date() },
      create: {
        fromPath,
        toPath,
        type: RedirectType.MOVED_PERMANENTLY,
        isAutoGenerated: true,
      },
    });
    this.logger.log(`upsertAutoRedirect: ${fromPath} → ${toPath}`);
  }

  // ── SEO Health ──────────────────────────────────────────────────────────────

  /**
   * Caches the latest submission-health snapshot (written by the daily health-check
   * job in SitemapProcessor) so the admin SEO surface reads it without re-probing the
   * engines on every request. See [DR-16].
   */
  async setSubmissionHealth(health: SubmissionHealth): Promise<void> {
    await this.redis.setex(
      SEO_SUBMISSION_HEALTH_CACHE_KEY,
      SEO_SUBMISSION_HEALTH_TTL_SECONDS,
      JSON.stringify(health),
    );
  }

  /** Reads the cached submission-health snapshot, or null when none has been recorded. */
  async getSubmissionHealth(): Promise<SubmissionHealth | null> {
    const cached = await this.redis.get(SEO_SUBMISSION_HEALTH_CACHE_KEY);
    if (!cached) return null;
    try {
      return JSON.parse(cached) as SubmissionHealth;
    } catch {
      return null;
    }
  }

  /**
   * Returns an SEO health report:
   * - products missing metaTitle or metaDescription
   * - products with images missing alt text
   * - published CMS pages without metaDescription
   */
  async getHealth() {
    const jsonNullFilter = { equals: Prisma.JsonNull };

    const [productsMissingMeta, productsMissingAlt, pagesMissingMeta] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          deletedAt: null,
          OR: [{ metaTitle: jsonNullFilter }, { metaDescription: jsonNullFilter }],
        },
        select: { id: true, name: true, slug: true },
        take: SEO_HEALTH_MAX_ITEMS,
      }),

      // Per asset-variant-serving (AV1) — `url` is now the canonical
      // 'detail'-intent variant URL (large 1200 px webp) on READY assets;
      // PROCESSING/PENDING rows carry an empty string. The SEO-health
      // report is admin-internal so the raw `url` field is acceptable here.
      this.prisma.asset.findMany({
        where: { alt: jsonNullFilter, mimeType: { startsWith: 'image/' } },
        select: { id: true, url: true, mimeType: true },
        take: SEO_HEALTH_MAX_ITEMS,
      }),

      this.prisma.cmsPage.findMany({
        where: {
          isPublished: true,
          deletedAt: null,
          metaDescription: jsonNullFilter,
        },
        select: { id: true, slug: true, title: true },
        take: SEO_HEALTH_MAX_ITEMS,
      }),
    ]);

    // Return the payload directly — ApiResponseInterceptor wraps it in { data: ... }.
    // A manual { data: ... } wrapper here causes double-wrapping per api-conventions.md.
    return {
      productsMissingMeta: {
        count: productsMissingMeta.length,
        items: productsMissingMeta,
      },
      productsMissingAlt: {
        count: productsMissingAlt.length,
        items: productsMissingAlt,
      },
      pagesMissingMeta: {
        count: pagesMissingMeta.length,
        items: pagesMissingMeta,
      },
      // Latest snapshot from the daily submission-health probe (DR-16); null until the
      // first run. Lets the admin SEO surface show whether GSC/Bing/public-sitemap
      // submission is actually working — the guard against silent fail-open regressions.
      submissionHealth: await this.getSubmissionHealth(),
    };
  }
}
