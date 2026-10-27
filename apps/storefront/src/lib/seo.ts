import * as z from 'zod';

import { getChromeStrings, type ChromeIdentity } from '../i18n';
import { SUPPORTED_LOCALES, type Locale } from '../i18n/types';
import {
  ogLocaleAlternates,
  ogLocaleFromLocale,
  regionFromLocale,
  type RegionSource,
} from './locale-region';
import { pickTranslation, type ResolvedString } from '@storefront-types';
import { moneyFractionDigits, type MoneyFormat } from './money';

/**
 * JSON-LD generators for the storefront. Each generator returns a typed
 * object that round-trips through a Zod schema mirroring the schema.org
 * vocabulary it emits. Storefront pages render the resulting payloads
 * inline as `<script type="application/ld+json">` tags.
 *
 * Authority: `agent_docs/storefront/seo-geo.md` §"JSON-LD" (Home → Organization
 * + WebSite + BreadcrumbList).
 */

const JSON_LD_CONTEXT = 'https://schema.org' as const;

/**
 * Every `hreflang` set this file emits, derived from the single source at
 * `locale-region.ts` rather than restated.
 *
 * The four builders below each used to carry the triplet as literals. The
 * SEO audit called that the single biggest miss risk in the surface, and it
 * was right for a reason worth keeping: fixing the map fixed nothing, because
 * the map had no consumers on these paths. `pathFor` receives the locale and
 * returns the locale-prefixed path, so a builder states its URL shape once
 * and the locale fan-out plus `x-default` come from here.
 */
export function hreflangSet(
  baseUrl: string,
  pathFor: (locale: Locale) => string,
  locales: SeoLocaleContext,
): { hreflang: string; href: string }[] {
  return [
    ...locales.supportedLocales.map((locale) => ({
      hreflang: regionFromLocale(locale, locales),
      href: joinUrl(baseUrl, pathFor(locale)),
    })),
    { hreflang: 'x-default', href: joinUrl(baseUrl, pathFor(locales.defaultLocale)) },
  ];
}

/**
 * The locale facts every SEO builder needs: which locales the store serves,
 * which one `x-default` points at, and the country the region tail names.
 *
 * Passed in rather than read from a constant, because all three are runtime
 * config on a generic engine (DR-31). A builder that assumed them was a
 * builder that only ever produced correct markup for one install.
 */
export interface SeoLocaleContext extends RegionSource {
  supportedLocales: readonly Locale[];
  defaultLocale: Locale;
}

/**
 * Share card for `og:image` and `twitter:image`, 1200x630 per the OG spec.
 * Built from the D0 logo kit by `scripts/build-og-share-card.mjs`; that script
 * is the reproducible source, this constant is the path it writes to.
 */
export const OG_SHARE_CARD = '/brand/default/og-share-card.png';

/** Square raster for schema.org `Organization.logo`. */
const ORGANIZATION_LOGO = '/brand/default/app-icon-512.png';

const organizationJsonLdSchema = z.object({
  '@context': z.literal(JSON_LD_CONTEXT),
  '@type': z.literal('Organization'),
  name: z.string().min(1),
  url: z.string().url(),
  logo: z.string().url(),
  description: z.string().min(1),
  inLanguage: z.string().min(2),
  /**
   * The configured `identity.areaServed`. schema.org takes one value or many,
   * and a store that has configured none omits the key rather than publishing
   * a guess (plan E2.5.3). It used to be the literal of one client's market.
   */
  areaServed: z.union([z.string().min(2), z.array(z.string().min(2)).min(1)]).optional(),
  sameAs: z.array(z.string().url()).optional(),
  contactPoint: z
    .object({
      '@type': z.literal('ContactPoint'),
      contactType: z.literal('customer support'),
      email: z.string().email(),
      telephone: z.string().min(1).optional(),
      availableLanguage: z.array(z.string().min(2)),
    })
    .optional(),
});
export type OrganizationJsonLd = z.infer<typeof organizationJsonLdSchema>;

/**
 * The operator-configured half of the Organization payload (finding D4).
 *
 * The store name, description and served area are required: they used to be
 * spelled into the chrome catalogues and into a branch-baked literal, and DR-31
 * makes them runtime config, so a caller that cannot supply them is a caller
 * that would publish the wrong store (plan E2.5.3). The rest stay optional and
 * an absent one emits the same payload it did before it existed.
 */
export interface StoreIdentityInput {
  /** Store name, already resolved for the locale being rendered. */
  storeName: string;
  /** Store description, resolved for the locale. Empty falls back to the chrome copy. */
  description?: string | null;
  /** ISO 3166-1 alpha-2 markets the store serves. Empty omits the key. */
  areaServed?: readonly string[];
  contactEmail?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
  socialLinks?: readonly { platform: string; url: string }[];
  /**
   * The locales the store serves, for the contact point's
   * `availableLanguage`. Absent falls back to the build catalogue, which is
   * only right for a store that enabled all of it.
   */
  supportedLocales?: readonly Locale[];
}

const websiteJsonLdSchema = z.object({
  '@context': z.literal(JSON_LD_CONTEXT),
  '@type': z.literal('WebSite'),
  name: z.string().min(1),
  url: z.string().url(),
  inLanguage: z.string().min(2),
  potentialAction: z
    .object({
      '@type': z.literal('SearchAction'),
      target: z.object({
        '@type': z.literal('EntryPoint'),
        urlTemplate: z.string().min(1),
      }),
      'query-input': z.string().min(1),
    })
    .optional(),
});
export type WebsiteJsonLd = z.infer<typeof websiteJsonLdSchema>;

const breadcrumbItemSchema = z.object({
  '@type': z.literal('ListItem'),
  position: z.number().int().positive(),
  name: z.string().min(1),
  item: z.string().url(),
});
const breadcrumbListJsonLdSchema = z.object({
  '@context': z.literal(JSON_LD_CONTEXT),
  '@type': z.literal('BreadcrumbList'),
  itemListElement: z.array(breadcrumbItemSchema).min(1),
});
export type BreadcrumbListJsonLd = z.infer<typeof breadcrumbListJsonLdSchema>;

export interface BreadcrumbInput {
  name: string;
  url: string;
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${normalizedPath}`;
}

/**
 * An absolute `http(s)` URL, or nothing.
 *
 * `organizationJsonLdSchema.parse` throws on a malformed URL, and this payload
 * is built from operator-editable settings, so one junk row would take the home
 * page down. Every configured URL is filtered through here first: a bad value
 * costs the store one link, never a page. The scheme check is what keeps a
 * `javascript:` value out of the emitted markup.
 *
 * Deliberately NOT resolved against the site origin: a social profile typed as
 * `nope` is a typo, and resolving it would publish `https://the-store/nope` to a
 * crawler as this brand's Facebook page.
 */
function absoluteUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A store asset URL, resolved against the site origin when it is a path.
 *
 * Unlike a social profile, a configured logo IS commonly stored as a path, so
 * `/uploads/logo.png` is a legitimate value and resolving it is correct.
 */
function assetUrl(value: string | null | undefined, baseUrl: string): string | null {
  if (!value) return null;
  try {
    const resolved = new URL(value, `${baseUrl.replace(/\/$/, '')}/`);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:'
      ? resolved.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * The chrome-copy half of a JSON-LD identity input, for the two leaves this
 * builder still falls back to when the operator has configured neither a store
 * description nor a name. The country is the first market served, which is the
 * only one a single-value copy slot can name.
 */
function chromeIdentityOf(identity: StoreIdentityInput): ChromeIdentity {
  return { storeName: identity.storeName, country: identity.areaServed?.[0] ?? '' };
}

export function organizationJsonLd(
  locale: Locale,
  baseUrl: string,
  identity: StoreIdentityInput,
): OrganizationJsonLd {
  const strings = getChromeStrings(locale, chromeIdentityOf(identity));
  const areaServed = identity.areaServed ?? [];
  const payload: OrganizationJsonLd = {
    '@context': JSON_LD_CONTEXT,
    '@type': 'Organization',
    name: identity.storeName || strings.brand.name,
    url: joinUrl(baseUrl, `/${locale}/`),
    logo: assetUrl(identity.logoUrl, baseUrl) ?? joinUrl(baseUrl, ORGANIZATION_LOGO),
    description: identity.description?.trim() || strings.meta.description,
    inLanguage: locale,
    ...(areaServed.length === 1
      ? { areaServed: areaServed[0] }
      : areaServed.length > 1
        ? { areaServed: [...areaServed] }
        : {}),
  };

  const sameAs = (identity.socialLinks ?? [])
    .map((link) => absoluteUrl(link.url))
    .filter((url): url is string => url !== null);
  if (sameAs.length) payload.sameAs = sameAs;

  const email = identity.contactEmail?.trim();
  if (email) {
    payload.contactPoint = {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email,
      // The locales this store actually serves, not the build catalogue. A
      // store that enabled two must not advertise support in a third.
      availableLanguage: [...(identity.supportedLocales ?? SUPPORTED_LOCALES)],
      ...(identity.phone?.trim() ? { telephone: identity.phone.trim() } : {}),
    };
  }

  return organizationJsonLdSchema.parse(payload);
}

export function websiteJsonLd(
  locale: Locale,
  baseUrl: string,
  identity: ChromeIdentity,
): WebsiteJsonLd {
  const strings = getChromeStrings(locale, identity);
  const homeUrl = joinUrl(baseUrl, `/${locale}/`);
  const payload: WebsiteJsonLd = {
    '@context': JSON_LD_CONTEXT,
    '@type': 'WebSite',
    name: strings.brand.name,
    url: homeUrl,
    inLanguage: locale,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: joinUrl(baseUrl, `/${locale}/search?q={search_term_string}`),
      },
      'query-input': 'required name=search_term_string',
    },
  };
  return websiteJsonLdSchema.parse(payload);
}

export function breadcrumbListJsonLd(items: BreadcrumbInput[]): BreadcrumbListJsonLd {
  const payload: BreadcrumbListJsonLd = {
    '@context': JSON_LD_CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((entry, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: entry.name,
      item: entry.url,
    })),
  };
  return breadcrumbListJsonLdSchema.parse(payload);
}

/**
 * JSON-stringify a JSON-LD payload and harden against `</script>` injection
 * (escape every forward-slash inside an end-tag-looking sequence). The
 * payload is otherwise inert (script type `application/ld+json` is not
 * executable) but the escape keeps the surrounding HTML well-formed even
 * if a translatable string ever contains a literal `</script>`.
 */
export function serializeJsonLd(payload: object): string {
  return JSON.stringify(payload).replace(/<\/(script)/gi, '<\\/$1');
}

export interface HomeMetaInput {
  locale: Locale;
  baseUrl: string;
  /** The store's name and country, filled into the chrome copy (plan E2.5). */
  identity: ChromeIdentity;
  /** The store's locale set and country, for hreflang and og:locale. */
  locales: SeoLocaleContext;
}

export interface HomeMetaTags {
  title: string;
  description: string;
  canonical: string;
  hreflang: { hreflang: string; href: string }[];
  og: {
    title: string;
    description: string;
    image: string;
    url: string;
    locale: string;
    /**
     * `og:locale:alternate` — OG-format codes for every locale OTHER than the
     * resolved one. Per Open Graph spec: a page is in one locale; alternates
     * advertise equivalent variants. On `/fr/...` carries `['en_TN']`; on
     * `/en/...` carries `['fr_TN']`. Driven by the SSOT at `locale-region.ts`.
     */
    localeAlternate: string[];
    type: 'website';
  };
  twitter: {
    card: 'summary_large_image';
    title: string;
    description: string;
    image: string;
  };
}

/* -----------------------------------------------------------------------
 * S6 — Catalog: ItemList + Product schemas + per-page meta helpers.
 *
 * `itemListJsonLd` summarizes a category page as a schema.org `ItemList`
 * (one `ListItem` per product). `productJsonLd` emits a schema.org
 * `Product` payload for a product detail page, with offers derived from
 * the default variant, `aggregateRating` only when the rating summary
 * carries at least one review, and `review[]` truncated to the first 3
 * (the page renders the same 3 above the fold).
 * ----------------------------------------------------------------------- */

const itemListItemSchema = z.object({
  '@type': z.literal('ListItem'),
  position: z.number().int().positive(),
  url: z.string().url(),
  name: z.string().min(1),
});
const itemListJsonLdSchema = z.object({
  '@context': z.literal(JSON_LD_CONTEXT),
  '@type': z.literal('ItemList'),
  itemListElement: z.array(itemListItemSchema).min(1),
  numberOfItems: z.number().int().nonnegative(),
});
export type ItemListJsonLd = z.infer<typeof itemListJsonLdSchema>;

export interface ItemListEntryInput {
  slug: string;
  name: string;
}

export function itemListJsonLd(
  items: ItemListEntryInput[],
  locale: Locale,
  baseUrl: string,
): ItemListJsonLd {
  const payload: ItemListJsonLd = {
    '@context': JSON_LD_CONTEXT,
    '@type': 'ItemList',
    itemListElement: items.map((entry, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      url: joinUrl(baseUrl, `/${locale}/catalog/product/${entry.slug}`),
      name: entry.name,
    })),
    numberOfItems: items.length,
  };
  return itemListJsonLdSchema.parse(payload);
}

const productOfferSchema = z.object({
  '@type': z.literal('Offer'),
  url: z.string().url(),
  priceCurrency: z.string().length(3),
  price: z.string().regex(/^\d+(\.\d+)?$/),
  availability: z.enum(['https://schema.org/InStock', 'https://schema.org/OutOfStock']),
});
const productAggregateRatingSchema = z.object({
  '@type': z.literal('AggregateRating'),
  ratingValue: z.number().min(0).max(5),
  reviewCount: z.number().int().positive(),
});
const productReviewSchema = z.object({
  '@type': z.literal('Review'),
  reviewRating: z.object({
    '@type': z.literal('Rating'),
    ratingValue: z.number().int().min(1).max(5),
    bestRating: z.literal(5),
  }),
  author: z.object({
    '@type': z.literal('Person'),
    name: z.string().min(1),
  }),
  reviewBody: z.string().min(1),
  datePublished: z.string().min(1),
});
/**
 * schema.org condition value. `agent_docs/storefront/seo-geo.md` "Product
 * rich-results enrichment" names it an always-emitted field, and this store
 * sells new goods only, so it is a constant rather than a per-product value.
 * A catalogue that ever carries refurbished stock needs it read from the
 * product row instead.
 */
const ITEM_CONDITION_NEW = 'https://schema.org/NewCondition' as const;

const productJsonLdSchema = z.object({
  '@context': z.literal(JSON_LD_CONTEXT),
  '@type': z.literal('Product'),
  name: z.string().min(1),
  description: z.string().min(1),
  image: z.array(z.string().url()).min(1),
  sku: z.string().optional(),
  brand: z.object({ '@type': z.literal('Brand'), name: z.string().min(1) }).optional(),
  itemCondition: z.literal(ITEM_CONDITION_NEW),
  offers: productOfferSchema,
  aggregateRating: productAggregateRatingSchema.optional(),
  review: z.array(productReviewSchema).optional(),
});
export type ProductJsonLd = z.infer<typeof productJsonLdSchema>;

export interface ProductJsonLdInput {
  slug: string;
  name: string;
  description: string;
  imageUrls: string[];
  sku?: string | null;
  brand?: string | null;
  price: number | string;
  currency: string;
  /** The store's money format, for the fraction digits Schema.org demands. */
  money: MoneyFormat;
  inStock: boolean;
  reviewSummary?: { averageRating: number; total: number } | null;
  firstReviews?: {
    rating: number;
    body: string;
    authorName: string;
    createdAt: string;
  }[];
}

export function productJsonLd(
  input: ProductJsonLdInput,
  locale: Locale,
  baseUrl: string,
): ProductJsonLd {
  const productUrl = joinUrl(baseUrl, `/${locale}/catalog/product/${input.slug}`);
  // Fraction digits from the currency, not a literal 2. Schema.org Offer.price
  // is machine-read: a three-decimal amount printed to two misstates the price
  // to every consumer of the feed.
  const priceString =
    typeof input.price === 'number'
      ? input.price.toFixed(moneyFractionDigits(input.money, input.currency))
      : input.price;
  const payload: ProductJsonLd = {
    '@context': JSON_LD_CONTEXT,
    '@type': 'Product',
    name: input.name,
    // schema.org `description` is a plain-text slot. The value is admin-authored
    // rich text, so without this a two-item list shipped to crawlers verbatim as
    // `"description":"<p>...</p><ul><li>...</li></ul>"`. Observed on a live page.
    description: stripHtml(input.description),
    image: input.imageUrls,
    itemCondition: ITEM_CONDITION_NEW,
    offers: {
      '@type': 'Offer',
      url: productUrl,
      priceCurrency: input.currency,
      price: priceString,
      availability: input.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
  };
  if (input.sku) payload.sku = input.sku;
  if (input.brand) payload.brand = { '@type': 'Brand', name: input.brand };
  if (input.reviewSummary && input.reviewSummary.total > 0) {
    payload.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: input.reviewSummary.averageRating,
      reviewCount: input.reviewSummary.total,
    };
  }
  if (input.firstReviews && input.firstReviews.length > 0) {
    payload.review = input.firstReviews.slice(0, 3).map((r) => ({
      '@type': 'Review' as const,
      reviewRating: {
        '@type': 'Rating' as const,
        ratingValue: r.rating,
        bestRating: 5 as const,
      },
      author: { '@type': 'Person' as const, name: r.authorName },
      reviewBody: r.body,
      datePublished: r.createdAt,
    }));
  }
  return productJsonLdSchema.parse(payload);
}

/* -----------------------------------------------------------------------
 * S6 — Per-page meta helpers (category + product) that mirror the
 * `homeMetaTags` shape so the page templates can apply Title / Meta
 * services with the same iteration helper.
 * ----------------------------------------------------------------------- */

export interface PageMetaTags {
  title: string;
  description: string;
  canonical: string;
  hreflang: { hreflang: string; href: string }[];
  og: {
    title: string;
    description: string;
    image: string;
    url: string;
    locale: string;
    /**
     * `og:locale:alternate` — OG-format codes for every locale OTHER than the
     * resolved one. Per Open Graph spec: a page is in one locale; alternates
     * advertise equivalent variants. Driven by the SSOT at `locale-region.ts`.
     */
    localeAlternate: string[];
    type: 'website' | 'product';
  };
  twitter: {
    card: 'summary_large_image';
    title: string;
    description: string;
    image: string;
  };
}

export interface CategoryMetaInput {
  locale: Locale;
  baseUrl: string;
  /** The store's name and country, filled into the chrome copy (plan E2.5). */
  identity: ChromeIdentity;
  /** The store's locale set and country, for hreflang and og:locale. */
  locales: SeoLocaleContext;
  slug: string;
  name: ResolvedString;
  description?: ResolvedString | null;
}

const META_TITLE_MAX = 60;
const META_DESC_MAX = 200;
const META_DESC_FALLBACK_MIN = 40;

/**
 * Separator between an entity name and the brand name in a `<title>`.
 *
 * Was an em dash. French copy runs 15 to 20 percent longer than the English
 * these titles were sized against, so the 60-character ceiling is now the
 * common case rather than the edge case, and the em dash is also the one
 * character the house style rules out.
 */
export const META_TITLE_SEPARATOR = ' · ';

/**
 * Compose a `<title>` that always ends with the store suffix.
 *
 * Finding A5. Every page calls `Title.setTitle` directly with a full i18n
 * string, so the suffix was a copywriting convention rather than a rule, and
 * the pages whose string forgot it (returns, cart) shipped a bare heading as
 * their tab title. Routing every call site through here makes the suffix
 * structural.
 *
 * Idempotent: a string that already carries the suffix as one of its
 * separator-delimited segments is returned unchanged, so the pages whose copy
 * carries it keep exactly the title they have today.
 *
 * "One of its segments", not "its last segment". The home page's own
 * `meta.title` is "<brand> · <tagline>", so `/en` shipped
 * the store name twice over: an end-anchored guard only
 * sees the brand when the copy happens to put it last.
 *
 * Segments, not a substring: "About the store and us" is a sentence that
 * mentions the brand, not a title that carries it, and it still needs the tab
 * suffix.
 */
export function pageTitle(title: string, suffix: string): string {
  const base = title.trim();
  const tail = suffix.trim();
  if (!tail) return base;
  if (!base) return tail;
  const segments = base.split(META_TITLE_SEPARATOR).map((part) => part.trim());
  if (segments.includes(tail)) return base;
  return `${base}${META_TITLE_SEPARATOR}${tail}`;
}

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Flatten admin-authored rich text to a single line of plain prose.
 *
 * Product and Category descriptions are authored with the rich-text editor, so
 * they carry `<p>`, `<ul>` and `<li>`. A meta description, an og:description and
 * a JSON-LD `description` are all plain-text slots: markup in them is emitted
 * verbatim to crawlers. Confirmed on a live page before this was added, where
 * a two-item list shipped as
 * `"description":"<p>Essai <strong>gras</strong></p><ul><li>...</li></ul>"`
 * inside the JSON-LD block.
 *
 * Entities are decoded after the strip so `&amp;` reads as `&` rather than
 * surviving into a description that a crawler will escape a second time.
 * Block-level tags become a space, not nothing, so "one</p><p>two" does not
 * become "onetwo".
 *
 * Mirrors the strip already used in about.page.ts and policies/[slug].page.ts;
 * this is the shared version those two should eventually call.
 */
export function stripHtml(text: string): string {
  return (text ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#3(?:9);/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `<name> · <store>`, clamped so the STORE NAME survives.
 *
 * `clamp()` on the joined string truncates from the right, which eats the
 * brand name and ships a title ending in a half-spelled brand. Clamping the
 * name instead keeps the title ending on a clean, complete brand, which is
 * the half a reader actually needs to recognise. When even the brand alone
 * will not fit, the brand alone is still the better answer than a fragment
 * of both.
 */
function titleWithBrand(name: string, brand: string): string {
  if (!name) return clamp(brand, META_TITLE_MAX);
  const full = `${name}${META_TITLE_SEPARATOR}${brand}`;
  if (full.length <= META_TITLE_MAX) return full;

  const roomForName = META_TITLE_MAX - META_TITLE_SEPARATOR.length - brand.length;
  if (roomForName < 1) return clamp(brand, META_TITLE_MAX);
  return `${clamp(name, roomForName)}${META_TITLE_SEPARATOR}${brand}`;
}

function ensureMin(text: string, min: number, padder: string): string {
  if (text.length >= min) return text;
  return clamp(`${text}${text ? ' ' : ''}${padder}`.trim(), META_DESC_MAX);
}

export function categoryMetaTags(input: CategoryMetaInput): PageMetaTags {
  const strings = getChromeStrings(input.locale, input.identity);
  const categoryName = pickTranslation(input.name, input.locale) || strings.nav.catalog;
  const title = titleWithBrand(categoryName, strings.brand.name);
  // Strip before clamp: the description is admin-authored rich text and every
  // consumer below (meta description, og, twitter, JSON-LD) is a plain-text slot.
  const descRaw = input.description
    ? stripHtml(pickTranslation(input.description, input.locale))
    : '';
  const description = ensureMin(
    clamp(descRaw, META_DESC_MAX),
    META_DESC_FALLBACK_MIN,
    strings.meta.description,
  );
  const canonical = joinUrl(input.baseUrl, `/${input.locale}/catalog/${input.slug}`);
  const ogImage = joinUrl(input.baseUrl, OG_SHARE_CARD);

  return {
    title,
    description,
    canonical,
    hreflang: hreflangSet(
      input.baseUrl,
      (locale) => `/${locale}/catalog/${input.slug}`,
      input.locales,
    ),
    og: {
      title,
      description,
      image: ogImage,
      url: canonical,
      locale: ogLocaleFromLocale(input.locale, input.locales),
      localeAlternate: ogLocaleAlternates(
        input.locale,
        input.locales.supportedLocales,
        input.locales,
      ),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      image: ogImage,
    },
  };
}

export interface ProductMetaInput {
  locale: Locale;
  baseUrl: string;
  /** The store's name and country, filled into the chrome copy (plan E2.5). */
  identity: ChromeIdentity;
  /** The store's locale set and country, for hreflang and og:locale. */
  locales: SeoLocaleContext;
  slug: string;
  name: ResolvedString;
  description?: ResolvedString | null;
  primaryImageUrl?: string | null;
}

export function productMetaTags(input: ProductMetaInput): PageMetaTags {
  const strings = getChromeStrings(input.locale, input.identity);
  const productName = pickTranslation(input.name, input.locale);
  const title = titleWithBrand(productName, strings.brand.name);
  // Strip before clamp: the description is admin-authored rich text and every
  // consumer below (meta description, og, twitter, JSON-LD) is a plain-text slot.
  const descRaw = input.description
    ? stripHtml(pickTranslation(input.description, input.locale))
    : '';
  const description = ensureMin(
    clamp(descRaw, META_DESC_MAX),
    META_DESC_FALLBACK_MIN,
    strings.meta.description,
  );
  const canonical = joinUrl(input.baseUrl, `/${input.locale}/catalog/product/${input.slug}`);
  const ogImage = input.primaryImageUrl
    ? input.primaryImageUrl
    : joinUrl(input.baseUrl, OG_SHARE_CARD);

  return {
    title,
    description,
    canonical,
    hreflang: hreflangSet(
      input.baseUrl,
      (locale) => `/${locale}/catalog/product/${input.slug}`,
      input.locales,
    ),
    og: {
      title,
      description,
      image: ogImage,
      url: canonical,
      locale: ogLocaleFromLocale(input.locale, input.locales),
      localeAlternate: ogLocaleAlternates(
        input.locale,
        input.locales.supportedLocales,
        input.locales,
      ),
      type: 'product',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      image: ogImage,
    },
  };
}

/* -----------------------------------------------------------------------
 * S13 — FAQPage JSON-LD generator. Wired ahead of the S15 about / policies
 * pages so an editorial surface can call `faqPageJsonLd([...])` without
 * re-opening this module. Mirrors schema.org `FAQPage` →
 * `mainEntity: Question[]` with `acceptedAnswer: Answer`.
 * ----------------------------------------------------------------------- */

const faqAnswerSchema = z.object({
  '@type': z.literal('Answer'),
  text: z.string().min(1),
});
const faqQuestionSchema = z.object({
  '@type': z.literal('Question'),
  name: z.string().min(1),
  acceptedAnswer: faqAnswerSchema,
});
const faqPageJsonLdSchema = z.object({
  '@context': z.literal(JSON_LD_CONTEXT),
  '@type': z.literal('FAQPage'),
  mainEntity: z.array(faqQuestionSchema).min(1),
});
export type FaqPageJsonLd = z.infer<typeof faqPageJsonLdSchema>;

export interface FaqEntryInput {
  question: string;
  answer: string;
}

export function faqPageJsonLd(items: FaqEntryInput[]): FaqPageJsonLd {
  const payload: FaqPageJsonLd = {
    '@context': JSON_LD_CONTEXT,
    '@type': 'FAQPage',
    mainEntity: items.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: entry.answer,
      },
    })),
  };
  return faqPageJsonLdSchema.parse(payload);
}

export interface StaticPageMetaInput {
  locale: Locale;
  baseUrl: string;
  /** The store's name and country, filled into the chrome copy (plan E2.5). */
  identity: ChromeIdentity;
  /** The store's locale set and country, for hreflang and og:locale. */
  locales: SeoLocaleContext;
  /** Path under the locale, e.g. `/about` or `/policies/privacy`. */
  path: string;
  title: string;
  description: string;
}

/**
 * Static-page meta tag builder used by `/about` and `/policies/{slug}`
 * (and any future SSG copy page). Mirrors `homeMetaTags` shape so the
 * page templates can reuse the same `<meta>` application logic. The
 * `path` arg should NOT include the locale segment — both alternates
 * are derived automatically.
 */
export function staticPageMetaTags(input: StaticPageMetaInput): PageMetaTags {
  const brand = getChromeStrings(input.locale, input.identity).brand.name;
  /**
   * The CMS surfaces set the document title imperatively, so the router-level
   * suffix in `title-strategy.ts` never reaches them and they shipped a bare
   * page name while every product and category page carried the brand.
   *
   * The guard is not defensive padding: the catalog landing passes
   * `strings.catalog.meta.title`, which already ends in the brand, and an
   * unconditional suffix printed it twice. It also covers an operator who
   * typed the brand into a CMS metaTitle.
   */
  const title = input.title.includes(brand)
    ? clamp(input.title, META_TITLE_MAX)
    : titleWithBrand(input.title, brand);
  const description = clamp(input.description, META_DESC_MAX);
  const canonical = joinUrl(input.baseUrl, `/${input.locale}${input.path}`);
  const ogImage = joinUrl(input.baseUrl, OG_SHARE_CARD);

  return {
    title,
    description,
    canonical,
    hreflang: hreflangSet(input.baseUrl, (locale) => `/${locale}${input.path}`, input.locales),
    og: {
      title,
      description,
      image: ogImage,
      url: canonical,
      locale: ogLocaleFromLocale(input.locale, input.locales),
      localeAlternate: ogLocaleAlternates(
        input.locale,
        input.locales.supportedLocales,
        input.locales,
      ),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      image: ogImage,
    },
  };
}

export function homeMetaTags(input: HomeMetaInput): HomeMetaTags {
  const strings = getChromeStrings(input.locale, input.identity);
  const canonical = joinUrl(input.baseUrl, `/${input.locale}/`);
  const ogImage = joinUrl(input.baseUrl, OG_SHARE_CARD);

  return {
    title: strings.meta.title,
    description: strings.meta.description,
    canonical,
    hreflang: hreflangSet(input.baseUrl, (locale) => `/${locale}/`, input.locales),
    og: {
      title: strings.meta.title,
      description: strings.meta.description,
      image: ogImage,
      url: canonical,
      locale: ogLocaleFromLocale(input.locale, input.locales),
      localeAlternate: ogLocaleAlternates(
        input.locale,
        input.locales.supportedLocales,
        input.locales,
      ),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: strings.meta.title,
      description: strings.meta.description,
      image: ogImage,
    },
  };
}
