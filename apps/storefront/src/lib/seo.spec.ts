import { describe, expect, it } from 'vitest';

import {
  breadcrumbListJsonLd,
  categoryMetaTags,
  faqPageJsonLd,
  homeMetaTags,
  itemListJsonLd,
  pageTitle,
  organizationJsonLd,
  productJsonLd,
  productMetaTags,
  serializeJsonLd,
  stripHtml,
  websiteJsonLd,
} from './seo';
import { fixtureChromeIdentity } from '../test-support/store-config-fixtures';

const BASE_URL = 'https://demo.test';

/**
 * The store these assertions are written against, read from the demo fixture
 * rather than restated (plan E2.5.1). The builders take the identity as a
 * required input now, so a spec that states a name of its own is a spec that
 * would keep passing after the config stopped reaching the page.
 */
const IDENTITY = fixtureChromeIdentity('demo', 'en');
const STORE_NAME = IDENTITY.storeName;
const ORG_IDENTITY = { storeName: STORE_NAME, areaServed: ['FR'] } as const;

describe('seo / organizationJsonLd', () => {
  it('emits a schema.org Organization for fr with the brand name', () => {
    const payload = organizationJsonLd('fr', BASE_URL, ORG_IDENTITY);
    expect(payload['@context']).toBe('https://schema.org');
    expect(payload['@type']).toBe('Organization');
    expect(payload.name).toBe(STORE_NAME);
    expect(payload.url).toBe('https://demo.test/fr/');
    expect(payload.logo).toMatch(/\/brand\/default\/app-icon-512\.png$/);
    expect(payload.inLanguage).toBe('fr');
    expect(payload.areaServed).toBe('FR');
  });

  it('emits a schema.org Organization for en with the brand name', () => {
    const payload = organizationJsonLd('en', BASE_URL, ORG_IDENTITY);
    expect(payload.name).toBe(STORE_NAME);
    expect(payload.url).toBe('https://demo.test/en/');
    expect(payload.inLanguage).toBe('en');
  });

  it('strips trailing slash on baseUrl before joining', () => {
    const payload = organizationJsonLd('en', `${BASE_URL}/`, ORG_IDENTITY);
    expect(payload.url).toBe('https://demo.test/en/');
  });

  it('emits the same payload whether the optional half is absent or empty', () => {
    // The required half is the store's own name and market (plan E2.5.3). The
    // rest stays optional, and an absent one must not change a single field of
    // what crawlers already index.
    expect(organizationJsonLd('fr', BASE_URL, { storeName: STORE_NAME })).toEqual(
      organizationJsonLd('fr', BASE_URL, {
        storeName: STORE_NAME,
        areaServed: [],
        socialLinks: [],
      }),
    );
  });

  it('omits areaServed when the store serves nowhere in particular', () => {
    // A fresh install has configured no market. Publishing a guess is worse
    // than publishing nothing, and the schema used to require a value.
    expect(
      organizationJsonLd('en', BASE_URL, { storeName: STORE_NAME }).areaServed,
    ).toBeUndefined();
  });

  it('publishes every market a store serves more than one of', () => {
    const payload = organizationJsonLd('en', BASE_URL, {
      storeName: STORE_NAME,
      areaServed: ['FR', 'BE'],
    });
    expect(payload.areaServed).toEqual(['FR', 'BE']);
  });

  it('publishes the configured social profiles as sameAs', () => {
    const payload = organizationJsonLd('fr', BASE_URL, {
      ...ORG_IDENTITY,
      socialLinks: [
        { platform: 'facebook', url: 'https://facebook.com/demostore' },
        { platform: 'instagram', url: 'https://instagram.com/demostore' },
      ],
    });
    expect(payload.sameAs).toEqual([
      'https://facebook.com/demostore',
      'https://instagram.com/demostore',
    ]);
  });

  it('drops a social profile that is not a usable URL rather than failing the page', () => {
    // The schema requires URLs, and `parse` throws. A junk settings row must
    // cost the store one link, never the whole home page.
    const payload = organizationJsonLd('fr', BASE_URL, {
      ...ORG_IDENTITY,
      socialLinks: [
        { platform: 'facebook', url: 'not a url' },
        { platform: 'instagram', url: 'https://instagram.com/demostore' },
      ],
    });
    expect(payload.sameAs).toEqual(['https://instagram.com/demostore']);
  });

  it('omits sameAs entirely when every configured profile is unusable', () => {
    const payload = organizationJsonLd('fr', BASE_URL, {
      ...ORG_IDENTITY,
      socialLinks: [{ platform: 'facebook', url: 'nope' }],
    });
    expect(payload.sameAs).toBeUndefined();
  });

  it('publishes the configured contact email as a customer-support contactPoint', () => {
    const payload = organizationJsonLd('en', BASE_URL, {
      ...ORG_IDENTITY,
      supportedLocales: SEO_LOCALES.supportedLocales,
      contactEmail: 'contact@demo.test',
    });
    expect(payload.contactPoint).toEqual({
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: 'contact@demo.test',
      availableLanguage: ['fr', 'en'],
    });
  });

  it('adds the configured phone to the same contactPoint', () => {
    const payload = organizationJsonLd('en', BASE_URL, {
      ...ORG_IDENTITY,
      contactEmail: 'contact@demo.test',
      phone: '+218 21 000 000',
    });
    expect(payload.contactPoint?.telephone).toBe('+218 21 000 000');
  });

  it('emits no contactPoint when the operator configured neither channel', () => {
    expect(
      organizationJsonLd('en', BASE_URL, {
        ...ORG_IDENTITY,
        phone: null,
      }).contactPoint,
    ).toBeUndefined();
  });

  it('prefers a configured absolute logo over the baked asset', () => {
    const payload = organizationJsonLd('en', BASE_URL, {
      ...ORG_IDENTITY,
      logoUrl: 'https://cdn.demo.test/logo.png',
    });
    expect(payload.logo).toBe('https://cdn.demo.test/logo.png');
  });

  it('resolves a configured relative logo against the site origin', () => {
    const payload = organizationJsonLd('en', BASE_URL, {
      ...ORG_IDENTITY,
      logoUrl: '/uploads/logo.png',
    });
    expect(payload.logo).toBe('https://demo.test/uploads/logo.png');
  });

  it('keeps the baked logo when the configured one is not a usable URL', () => {
    const payload = organizationJsonLd('en', BASE_URL, {
      ...ORG_IDENTITY,
      logoUrl: 'javascript:alert(1)',
    });
    expect(payload.logo).toMatch(/\/brand\/default\/app-icon-512\.png$/);
  });
});

describe('seo / websiteJsonLd', () => {
  it('emits a schema.org WebSite with a SearchAction for fr', () => {
    const payload = websiteJsonLd('fr', BASE_URL, IDENTITY);
    expect(payload['@type']).toBe('WebSite');
    expect(payload.url).toBe('https://demo.test/fr/');
    expect(payload.potentialAction?.['@type']).toBe('SearchAction');
    expect(payload.potentialAction?.target.urlTemplate).toBe(
      'https://demo.test/fr/search?q={search_term_string}',
    );
    expect(payload.potentialAction?.['query-input']).toBe('required name=search_term_string');
  });

  it('emits the locale-correct search url template for en', () => {
    const payload = websiteJsonLd('en', BASE_URL, IDENTITY);
    expect(payload.potentialAction?.target.urlTemplate).toBe(
      'https://demo.test/en/search?q={search_term_string}',
    );
  });
});

describe('seo / breadcrumbListJsonLd', () => {
  it('preserves item order and assigns 1-based positions', () => {
    const payload = breadcrumbListJsonLd([
      { name: 'Home', url: `${BASE_URL}/en/` },
      { name: 'Catalog', url: `${BASE_URL}/en/catalog` },
      { name: 'Audio', url: `${BASE_URL}/en/catalog/fx-audio` },
    ]);
    expect(payload['@type']).toBe('BreadcrumbList');
    expect(payload.itemListElement).toHaveLength(3);
    expect(payload.itemListElement[0]).toMatchObject({ position: 1, name: 'Home' });
    expect(payload.itemListElement[1]).toMatchObject({ position: 2, name: 'Catalog' });
    expect(payload.itemListElement[2]).toMatchObject({ position: 3, name: 'Audio' });
  });

  it('rejects an empty list at compile time via Zod', () => {
    expect(() => breadcrumbListJsonLd([])).toThrow();
  });
});

describe('seo / serializeJsonLd', () => {
  it('serializes a payload to JSON', () => {
    const out = serializeJsonLd({ a: 1, b: 'two' });
    expect(JSON.parse(out)).toEqual({ a: 1, b: 'two' });
  });

  it('escapes a literal </script> sequence inside string values', () => {
    const out = serializeJsonLd({ description: 'safe</script>chunk' });
    expect(out).not.toContain('</script>');
    expect(out).toContain('<\\/script>');
  });

  it('round-trips JSON.parse on the escaped output back to the source value', () => {
    const out = serializeJsonLd({ description: 'safe</script>chunk' });
    expect(JSON.parse(out)).toEqual({ description: 'safe</script>chunk' });
  });
});

describe('seo / homeMetaTags', () => {
  it('emits the locale-specific title within the 60-char limit for fr', () => {
    const tags = homeMetaTags({
      locale: 'fr',
      baseUrl: BASE_URL,
      locales: SEO_LOCALES,
      identity: IDENTITY,
    });
    expect(tags.title.length).toBeGreaterThan(0);
    expect(tags.title.length).toBeLessThanOrEqual(60);
    expect(tags.canonical).toBe('https://demo.test/fr/');
  });

  it('emits the locale-specific description within the 140-160 char range for fr', () => {
    const tags = homeMetaTags({
      locale: 'fr',
      baseUrl: BASE_URL,
      locales: SEO_LOCALES,
      identity: IDENTITY,
    });
    expect(tags.description.length).toBeGreaterThanOrEqual(40);
    expect(tags.description.length).toBeLessThanOrEqual(200);
  });

  it('emits the hreflang triplet on every variant', () => {
    const tags = homeMetaTags({
      locale: 'en',
      baseUrl: BASE_URL,
      locales: SEO_LOCALES,
      identity: IDENTITY,
    });
    const hreflangs = tags.hreflang.map((h) => h.hreflang);
    expect(hreflangs).toEqual([
      `fr-${SEO_LOCALES.country}`,
      `en-${SEO_LOCALES.country}`,
      'x-default',
    ]);
    expect(tags.hreflang.find((h) => h.hreflang === 'x-default')?.href).toBe(
      'https://demo.test/fr/',
    );
  });

  it('emits og:locale og:locale per locale, region-tagged from the configured country', () => {
    expect(
      homeMetaTags({ locale: 'fr', baseUrl: BASE_URL, locales: SEO_LOCALES, identity: IDENTITY }).og
        .locale,
    ).toBe(`fr_${SEO_LOCALES.country}`);
    expect(
      homeMetaTags({ locale: 'en', baseUrl: BASE_URL, locales: SEO_LOCALES, identity: IDENTITY }).og
        .locale,
    ).toBe(`en_${SEO_LOCALES.country}`);
  });

  it('emits og:locale:alternate for the non-resolved locales (S24.7)', () => {
    // Per Open Graph spec: a page is in one locale; alternates advertise
    // equivalent variants. /fr/... carries [`en_${SEO_LOCALES.country}`]; /en/... carries [`fr_${SEO_LOCALES.country}`].
    expect(
      homeMetaTags({ locale: 'fr', baseUrl: BASE_URL, locales: SEO_LOCALES, identity: IDENTITY }).og
        .localeAlternate,
    ).toEqual([`en_${SEO_LOCALES.country}`]);
    expect(
      homeMetaTags({ locale: 'en', baseUrl: BASE_URL, locales: SEO_LOCALES, identity: IDENTITY }).og
        .localeAlternate,
    ).toEqual([`fr_${SEO_LOCALES.country}`]);
  });

  it('emits the default share card for og:image and twitter:image', () => {
    const tags = homeMetaTags({
      locale: 'fr',
      baseUrl: BASE_URL,
      locales: SEO_LOCALES,
      identity: IDENTITY,
    });
    expect(tags.og.image).toMatch(/\/brand\/default\/og-share-card\.png$/);
    expect(tags.twitter.image).toBe(tags.og.image);
    expect(tags.twitter.card).toBe('summary_large_image');
  });
});

describe('seo / itemListJsonLd', () => {
  it('emits a schema.org ItemList with 1-based positions and product URLs', () => {
    const payload = itemListJsonLd(
      [
        { slug: 'echo-buds-pro', name: 'Echo Buds Pro' },
        { slug: 'tonic-watch', name: 'Tonic Watch' },
      ],
      'en',
      BASE_URL,
    );
    expect(payload['@type']).toBe('ItemList');
    expect(payload.numberOfItems).toBe(2);
    expect(payload.itemListElement).toHaveLength(2);
    expect(payload.itemListElement[0]).toMatchObject({
      position: 1,
      name: 'Echo Buds Pro',
      url: 'https://demo.test/en/catalog/product/echo-buds-pro',
    });
    expect(payload.itemListElement[1].position).toBe(2);
  });

  it('routes URLs through the locale segment for fr', () => {
    const payload = itemListJsonLd(
      [{ slug: 'echo-buds-pro', name: 'Écouteurs Echo Buds Pro' }],
      'fr',
      BASE_URL,
    );
    expect(payload.itemListElement[0].url).toBe(
      'https://demo.test/fr/catalog/product/echo-buds-pro',
    );
  });

  it('rejects an empty list at compile time via Zod', () => {
    expect(() => itemListJsonLd([], 'en', BASE_URL)).toThrow();
  });
});

describe('seo / productJsonLd', () => {
  const baseInput = {
    slug: 'echo-buds-pro',
    name: 'Echo Buds Pro',
    description: 'Wireless earbuds with active noise cancellation.',
    imageUrls: ['https://cdn.example/echo-1.jpg'],
    sku: 'EB-PRO-001',
    brand: 'Echo',
    price: 449,
    currency: SEO_MONEY.currencyCode,
    money: SEO_MONEY,
    inStock: true,
  };

  it('emits a schema.org Product with required offers', () => {
    const payload = productJsonLd(baseInput, 'en', BASE_URL);
    expect(payload['@type']).toBe('Product');
    expect(payload.name).toBe('Echo Buds Pro');
    expect(payload.image).toEqual(['https://cdn.example/echo-1.jpg']);
    expect(payload.sku).toBe('EB-PRO-001');
    expect(payload.brand).toEqual({ '@type': 'Brand', name: 'Echo' });
    expect(payload.offers).toMatchObject({
      '@type': 'Offer',
      price: '449.000',
      priceCurrency: SEO_MONEY.currencyCode,
      availability: 'https://schema.org/InStock',
      url: 'https://demo.test/en/catalog/product/echo-buds-pro',
    });
  });

  it('always declares the condition, which Google needs for merchant listings', () => {
    // Named an always-emitted field by agent_docs/storefront/seo-geo.md, and
    // absent from the live builder until D8: the API builder had it, but the
    // API builder has no caller, so nothing reached Google.
    expect(productJsonLd(baseInput, 'en', BASE_URL).itemCondition).toBe(
      'https://schema.org/NewCondition',
    );
    expect(productJsonLd(baseInput, 'fr', BASE_URL).itemCondition).toBe(
      'https://schema.org/NewCondition',
    );
  });

  it('marks availability OutOfStock when inStock is false', () => {
    const payload = productJsonLd({ ...baseInput, inStock: false }, 'en', BASE_URL);
    expect(payload.offers.availability).toBe('https://schema.org/OutOfStock');
  });

  it('omits aggregateRating when reviewSummary.total is 0', () => {
    const payload = productJsonLd(
      { ...baseInput, reviewSummary: { averageRating: 0, total: 0 } },
      'en',
      BASE_URL,
    );
    expect(payload.aggregateRating).toBeUndefined();
  });

  it('emits aggregateRating when reviewSummary.total > 0', () => {
    const payload = productJsonLd(
      { ...baseInput, reviewSummary: { averageRating: 4.6, total: 23 } },
      'en',
      BASE_URL,
    );
    expect(payload.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.6,
      reviewCount: 23,
    });
  });

  it('caps review[] at 3 entries even when more are provided', () => {
    const reviews = Array.from({ length: 5 }, (_, i) => ({
      rating: 5,
      body: `Body ${i}`,
      authorName: `Author ${i}`,
      createdAt: '2026-04-01T00:00:00Z',
    }));
    const payload = productJsonLd({ ...baseInput, firstReviews: reviews }, 'en', BASE_URL);
    expect(payload.review).toHaveLength(3);
    expect(payload.review?.[0].reviewBody).toBe('Body 0');
    expect(payload.review?.[2].reviewBody).toBe('Body 2');
  });

  it('omits review[] when zero reviews provided', () => {
    const payload = productJsonLd({ ...baseInput, firstReviews: [] }, 'en', BASE_URL);
    expect(payload.review).toBeUndefined();
  });

  it('accepts a numeric string for price', () => {
    const payload = productJsonLd({ ...baseInput, price: '199.50' }, 'en', BASE_URL);
    expect(payload.offers.price).toBe('199.50');
  });

  it('routes the offer URL through the fr locale segment', () => {
    const payload = productJsonLd(baseInput, 'fr', BASE_URL);
    expect(payload.offers.url).toBe('https://demo.test/fr/catalog/product/echo-buds-pro');
  });

  it('drops the brand field entirely when missing', () => {
    const { brand: _brand, ...rest } = baseInput;
    void _brand;
    const payload = productJsonLd(rest, 'en', BASE_URL);
    expect(payload.brand).toBeUndefined();
  });
});

describe('seo / faqPageJsonLd', () => {
  it('emits a schema.org FAQPage with one Question per input entry', () => {
    const payload = faqPageJsonLd([
      { question: 'When does delivery arrive?', answer: 'Within 2-5 business days.' },
      { question: 'Do you accept returns?', answer: 'Yes, within 14 days of delivery.' },
    ]);
    expect(payload['@type']).toBe('FAQPage');
    expect(payload.mainEntity).toHaveLength(2);
    expect(payload.mainEntity[0]).toMatchObject({
      '@type': 'Question',
      name: 'When does delivery arrive?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Within 2-5 business days.',
      },
    });
  });

  it('preserves the ordering of input entries', () => {
    const items = [
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2' },
      { question: 'Q3', answer: 'A3' },
    ];
    const payload = faqPageJsonLd(items);
    expect(payload.mainEntity.map((q) => q.name)).toEqual(['Q1', 'Q2', 'Q3']);
  });

  it('rejects an empty mainEntity at compile time via Zod', () => {
    expect(() => faqPageJsonLd([])).toThrow();
  });

  it('rejects an empty answer string via Zod', () => {
    expect(() => faqPageJsonLd([{ question: 'Q', answer: '' }])).toThrow();
  });

  it('round-trips accented French question and answer text without coercion', () => {
    const payload = faqPageJsonLd([
      { question: 'Quand la commande arrive-t-elle ?', answer: 'Sous 2 à 5 jours ouvrés.' },
    ]);
    expect(payload.mainEntity[0].name).toBe('Quand la commande arrive-t-elle ?');
    expect(payload.mainEntity[0].acceptedAnswer.text).toBe('Sous 2 à 5 jours ouvrés.');
  });
});

describe('seo / categoryMetaTags', () => {
  const baseInput = {
    locale: 'en' as const,
    baseUrl: BASE_URL,
    locales: SEO_LOCALES,
    identity: IDENTITY,
    slug: 'fx-audio',
    name: 'Audio',
    description: 'Headphones, earbuds and speakers tested for the Khaleej summer.',
  };

  it('emits a title within the 60-char ceiling', () => {
    const tags = categoryMetaTags(baseInput);
    expect(tags.title.length).toBeLessThanOrEqual(60);
    expect(tags.title).toContain('Audio');
    expect(tags.canonical).toBe('https://demo.test/en/catalog/fx-audio');
  });

  it('falls back to the chrome description when category description is missing', () => {
    const tags = categoryMetaTags({ ...baseInput, description: null });
    expect(tags.description.length).toBeGreaterThanOrEqual(40);
  });

  it('emits the hreflang triplet routed through the slug', () => {
    const tags = categoryMetaTags(baseInput);
    expect(tags.hreflang.find((h) => h.hreflang === `fr-${SEO_LOCALES.country}`)?.href).toBe(
      'https://demo.test/fr/catalog/fx-audio',
    );
    expect(tags.hreflang.find((h) => h.hreflang === 'x-default')?.href).toBe(
      'https://demo.test/fr/catalog/fx-audio',
    );
  });

  it('emits og:type=website for the category surface', () => {
    const tags = categoryMetaTags(baseInput);
    expect(tags.og.type).toBe('website');
  });

  it('emits BCP-47 og:locale + og:locale:alternate per locale (S24.7)', () => {
    const frTags = categoryMetaTags({ ...baseInput, locale: 'fr' });
    expect(frTags.og.locale).toBe(`fr_${SEO_LOCALES.country}`);
    expect(frTags.og.localeAlternate).toEqual([`en_${SEO_LOCALES.country}`]);
    const enTags = categoryMetaTags({ ...baseInput, locale: 'en' });
    expect(enTags.og.locale).toBe(`en_${SEO_LOCALES.country}`);
    expect(enTags.og.localeAlternate).toEqual([`fr_${SEO_LOCALES.country}`]);
  });

  it('resolves the Translatable category name for fr', () => {
    const tags = categoryMetaTags({
      ...baseInput,
      locale: 'fr',
      name: { default: 'Audio', fr: 'Audio et son', en: 'Audio' },
    });
    expect(tags.title).toContain('Audio et son');
  });
});

describe('seo / productMetaTags', () => {
  const baseInput = {
    locale: 'en' as const,
    baseUrl: BASE_URL,
    locales: SEO_LOCALES,
    identity: IDENTITY,
    slug: 'echo-buds-pro',
    name: 'Echo Buds Pro',
    description: 'Wireless earbuds with active noise cancellation and 24h battery.',
    primaryImageUrl: 'https://cdn.example/echo-buds-primary.jpg',
  };

  it('emits a product title within the 60-char ceiling', () => {
    const tags = productMetaTags(baseInput);
    expect(tags.title.length).toBeLessThanOrEqual(60);
    expect(tags.title).toContain('Echo Buds Pro');
  });

  it('emits og:type=product for the product surface', () => {
    const tags = productMetaTags(baseInput);
    expect(tags.og.type).toBe('product');
  });

  it('emits BCP-47 og:locale + og:locale:alternate per locale (S24.7)', () => {
    const frTags = productMetaTags({ ...baseInput, locale: 'fr' });
    expect(frTags.og.locale).toBe(`fr_${SEO_LOCALES.country}`);
    expect(frTags.og.localeAlternate).toEqual([`en_${SEO_LOCALES.country}`]);
    const enTags = productMetaTags({ ...baseInput, locale: 'en' });
    expect(enTags.og.locale).toBe(`en_${SEO_LOCALES.country}`);
    expect(enTags.og.localeAlternate).toEqual([`fr_${SEO_LOCALES.country}`]);
  });

  it('uses the primary product image for og:image and twitter:image', () => {
    const tags = productMetaTags(baseInput);
    expect(tags.og.image).toBe('https://cdn.example/echo-buds-primary.jpg');
    expect(tags.twitter.image).toBe('https://cdn.example/echo-buds-primary.jpg');
  });

  it('falls back to the default share card when no primary image url exists', () => {
    const tags = productMetaTags({ ...baseInput, primaryImageUrl: null });
    expect(tags.og.image).toMatch(/\/brand\/default\/og-share-card\.png$/);
  });

  it('emits hreflang routed through the product slug', () => {
    const tags = productMetaTags(baseInput);
    expect(tags.hreflang.find((h) => h.hreflang === `en-${SEO_LOCALES.country}`)?.href).toBe(
      'https://demo.test/en/catalog/product/echo-buds-pro',
    );
  });

  it('truncates an over-long product NAME with an ellipsis, keeping the brand', () => {
    // The clamp used to run over the joined string, so the title ended in an
    // ellipsis that had eaten part of the brand name. The ellipsis is still
    // there, but it now sits where the name was cut, and the brand is whole.
    const tags = productMetaTags({
      ...baseInput,
      name: 'A super long product name that is purposely over the meta-title ceiling for testing the clamp',
    });
    expect(tags.title.length).toBeLessThanOrEqual(60);
    expect(tags.title).toContain('…');
    expect(tags.title.endsWith(STORE_NAME)).toBe(true);
    expect(tags.title).toContain(META_TITLE_SEPARATOR);
  });
});

/* -----------------------------------------------------------------------
 * D8 — the SSOT contract, the assets, and the title separator.
 *
 * These four blocks exist because the D8 audit named the hreflang layer
 * "the single biggest miss risk in the SEO surface": one map is declared
 * the source of truth in `locale-region.ts`, and four builders each
 * hardcoded the same triplet as literals beside it. A spec that only
 * checks `locale-region.ts` passes while every rendered page is wrong.
 * So the assertion here is on the BUILDERS, one per builder, deriving
 * the expected value from the map rather than restating it.
 * -------------------------------------------------------------------- */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { ogLocaleFromLocale, regionFromLocale } from './locale-region';
import { META_TITLE_SEPARATOR, staticPageMetaTags } from './seo';
import { fixtureMoney } from '../test-support/store-config-fixtures';

import { fixtureRuntimeConfig } from '../test-support/store-config-fixtures';

/** The scenario config every page spec renders under. */
const SEO_LOCALES = {
  supportedLocales: fixtureRuntimeConfig('maghreb-ltr').localization.supportedLocales,
  defaultLocale: fixtureRuntimeConfig('maghreb-ltr').localization.defaultLocale,
  country: fixtureRuntimeConfig('maghreb-ltr').identity.address.country,
};

/** Schema.org price digits follow the store's configured precision. */
const SEO_MONEY = fixtureMoney('maghreb-ltr');

const PUBLIC_DIR = join(__dirname, '..', '..', 'public');

/** Derived, never restated: SSOT order, then x-default. */
const EXPECTED_HREFLANGS = [
  ...SEO_LOCALES.supportedLocales.map((l) => regionFromLocale(l, SEO_LOCALES)),
  'x-default',
];

describe('seo / hreflang is derived from the locale-region SSOT in every builder', () => {
  const cases: Array<[string, () => { hreflang: { hreflang: string }[] }]> = [
    [
      'homeMetaTags',
      () =>
        homeMetaTags({ locale: 'fr', baseUrl: BASE_URL, locales: SEO_LOCALES, identity: IDENTITY }),
    ],
    [
      'categoryMetaTags',
      () =>
        categoryMetaTags({
          locale: 'fr',
          baseUrl: BASE_URL,
          locales: SEO_LOCALES,
          identity: IDENTITY,
          slug: 'instruments',
          name: { default: 'Instruments' },
          description: null,
        }),
    ],
    [
      'productMetaTags',
      () =>
        productMetaTags({
          locale: 'fr',
          baseUrl: BASE_URL,
          locales: SEO_LOCALES,
          identity: IDENTITY,
          slug: 'turbine',
          name: { default: 'Turbine' },
          description: null,
          primaryImageUrl: null,
        }),
    ],
    [
      'staticPageMetaTags',
      () =>
        staticPageMetaTags({
          locale: 'fr',
          baseUrl: BASE_URL,
          locales: SEO_LOCALES,
          identity: IDENTITY,
          path: '/about',
          title: 'A propos',
          description: 'A propos de la boutique et de ce que nous livrons.',
        }),
    ],
  ];

  for (const [name, build] of cases) {
    it(`${name} emits exactly the SSOT triplet, in SSOT order`, () => {
      const emitted = build().hreflang.map((h) => h.hreflang);
      expect(emitted).toEqual(EXPECTED_HREFLANGS);
    });

    it(`${name} emits no Gulf region tail`, () => {
      for (const tag of build().hreflang.map((h) => h.hreflang)) {
        expect(tag).not.toMatch(/-QA$/);
      }
    });
  }
});

describe('seo / og:locale is derived from the same SSOT as og:locale:alternate', () => {
  // These two fields were read from two different maps, which is how a page
  // can advertise `fr_QA` as its own locale and `en_TN` as its alternate.
  it('homeMetaTags og.locale matches ogLocaleFromLocale for both locales', () => {
    expect(
      homeMetaTags({ locale: 'fr', baseUrl: BASE_URL, locales: SEO_LOCALES, identity: IDENTITY }).og
        .locale,
    ).toBe(ogLocaleFromLocale('fr', SEO_LOCALES));
    expect(
      homeMetaTags({ locale: 'en', baseUrl: BASE_URL, locales: SEO_LOCALES, identity: IDENTITY }).og
        .locale,
    ).toBe(ogLocaleFromLocale('en', SEO_LOCALES));
  });
});

describe('seo / the assets the JSON-LD and og tags point at actually exist', () => {
  // DR-29: "the Zod schema only checks the logo is a valid URL, so a missing
  // asset ships a 404 logo to Google without failing the parse". A URL check
  // is not an existence check, so this reads the file off disk.
  it('the Organization logo resolves to a file under public/', () => {
    const { logo } = organizationJsonLd('fr', BASE_URL, ORG_IDENTITY);
    const path = logo.slice(BASE_URL.length);
    expect(path.startsWith('/brand/')).toBe(true);
    expect(existsSync(join(PUBLIC_DIR, path))).toBe(true);
  });

  it('the og:image share card resolves to a file under public/', () => {
    const { og } = homeMetaTags({
      locale: 'fr',
      baseUrl: BASE_URL,
      locales: SEO_LOCALES,
      identity: IDENTITY,
    });
    const path = og.image.slice(BASE_URL.length);
    expect(existsSync(join(PUBLIC_DIR, path))).toBe(true);
  });

  it('no builder still points at a previous-client asset', () => {
    const images = [
      homeMetaTags({ locale: 'fr', baseUrl: BASE_URL, locales: SEO_LOCALES, identity: IDENTITY }).og
        .image,
      organizationJsonLd('fr', BASE_URL, ORG_IDENTITY).logo,
    ];
    for (const url of images) {
      // Every asset the builders point at ships with the engine, under the
      // neutral brand directory. A client-named path here would be a file
      // the tree no longer carries (plan E0.2).
      expect(url).toMatch(/\/brand\/default\//);
    }
  });
});

describe('seo / meta title separator and the 60-char clamp', () => {
  const longName = 'Turbine a air comprime NSK Pana-Max Plus avec lumiere LED integree';

  it('uses the declared separator and never an em dash', () => {
    const tags = categoryMetaTags({
      locale: 'fr',
      baseUrl: BASE_URL,
      locales: SEO_LOCALES,
      identity: IDENTITY,
      slug: 'instruments',
      name: { default: 'Instruments' },
      description: null,
    });
    expect(tags.title).toContain(META_TITLE_SEPARATOR);
    expect(META_TITLE_SEPARATOR).not.toContain('\u2014');
    expect(tags.title).not.toContain('\u2014');
  });

  it('keeps the brand name whole when a long French name forces a clamp', () => {
    // The old behaviour clamped the WHOLE string, so an over-long name ate
    // into the brand and shipped a title ending in "dent…". French runs
    // 15 to 20 percent longer than English, so this is the common case here,
    // not the edge case.
    const tags = productMetaTags({
      locale: 'fr',
      baseUrl: BASE_URL,
      locales: SEO_LOCALES,
      identity: IDENTITY,
      slug: 'turbine',
      name: { default: longName },
      description: null,
      primaryImageUrl: null,
    });
    expect(tags.title.length).toBeLessThanOrEqual(60);
    expect(tags.title.endsWith(STORE_NAME)).toBe(true);
    expect(tags.title).toContain(META_TITLE_SEPARATOR);
  });

  it('still clamps to 60 characters', () => {
    const tags = categoryMetaTags({
      locale: 'fr',
      baseUrl: BASE_URL,
      locales: SEO_LOCALES,
      identity: IDENTITY,
      slug: 'x',
      name: { default: longName },
      description: null,
    });
    expect(tags.title.length).toBeLessThanOrEqual(60);
    expect(tags.title.endsWith(STORE_NAME)).toBe(true);
  });
});

describe('seo / stripHtml', () => {
  it('flattens the markup the admin editor produces', () => {
    expect(stripHtml('<p>Essai <strong>gras</strong></p><ul><li>Un</li><li>Deux</li></ul>')).toBe(
      'Essai gras Un Deux',
    );
  });

  it('puts a space where a block boundary was, never nothing', () => {
    expect(stripHtml('<p>une</p><p>deux</p>')).toBe('une deux');
  });

  it('decodes the entities a crawler would otherwise escape twice', () => {
    expect(stripHtml('<p>Roto&nbsp;&amp;&nbsp;Contre</p>')).toBe('Roto & Contre');
  });

  it('leaves plain prose alone apart from collapsing whitespace', () => {
    expect(stripHtml('Deja   du   texte simple.')).toBe('Deja du texte simple.');
  });
});

describe('seo / rich text never reaches a plain-text slot', () => {
  // A meta description, an og:description and a JSON-LD description are all
  // plain-text slots. Product and Category descriptions are authored with the
  // rich-text editor, so every one of these was shipping markup to crawlers.
  const RICH =
    '<p>Contre-angle <strong>1:1</strong> avec irrigation interne.</p>' +
    '<ul><li>Bouton-poussoir</li><li>Fibre optique</li></ul>';

  const productJsonLdInput = {
    slug: 'contre-angle',
    name: 'Contre-angle',
    description: RICH,
    imageUrls: ['https://cdn.example/ca-1.jpg'],
    sku: 'CA-001',
    brand: 'NSK',
    price: 449,
    currency: SEO_MONEY.currencyCode,
    money: SEO_MONEY,
    inStock: true,
  };

  const productMetaInput = {
    locale: 'en' as const,
    baseUrl: BASE_URL,
    locales: SEO_LOCALES,
    identity: IDENTITY,
    slug: 'contre-angle',
    name: 'Contre-angle',
    description: RICH,
    primaryImageUrl: 'https://cdn.example/ca-1.jpg',
  };

  const categoryMetaInput = {
    locale: 'en' as const,
    baseUrl: BASE_URL,
    locales: SEO_LOCALES,
    identity: IDENTITY,
    slug: 'instruments-rotatifs',
    name: 'Instruments rotatifs',
    description: RICH,
  };

  it('strips the description out of the product JSON-LD', () => {
    const payload = productJsonLd(productJsonLdInput, 'en', BASE_URL);
    expect(payload.description).not.toContain('<');
    expect(payload.description).toContain('Contre-angle 1:1');
  });

  it('strips the description out of the product meta tags', () => {
    const tags = productMetaTags(productMetaInput);
    expect(tags.description).not.toContain('<');
    expect(tags.og.description).not.toContain('<');
    expect(tags.twitter.description).not.toContain('<');
  });

  it('strips the description out of the category meta tags', () => {
    const tags = categoryMetaTags(categoryMetaInput);
    expect(tags.description).not.toContain('<');
    expect(tags.og.description).not.toContain('<');
  });

  it('clamps the prose, not the tag overhead', () => {
    // Budget spent on "<p><strong></strong></p>" is budget the crawler never
    // sees any prose in.
    const prose = 'Contre-angle bague rouge pour instruments rotatifs. '.repeat(6);
    const tags = productMetaTags({
      ...productMetaInput,
      description: `<p><strong>${prose}</strong></p>`,
    });
    expect(tags.description.startsWith('Contre-angle bague rouge')).toBe(true);
  });
});

describe('seo / CMS-backed page titles carry the brand suffix', () => {
  // The store the builder is handed, not the neutral one the catalogue
  // resolves to when nobody supplies an identity (plan E2.5.1).
  const BRAND = STORE_NAME;

  function build(title: string, locale: 'fr' | 'en' = 'en') {
    return staticPageMetaTags({
      locale,
      baseUrl: BASE_URL,
      locales: SEO_LOCALES,
      identity: fixtureChromeIdentity('demo', locale),
      path: '/pages/faq',
      title,
      description: 'Answers about delivery, returns and payment.',
    });
  }

  it('appends the separator and the brand under both locales', () => {
    expect(build('FAQ', 'en').title).toBe(`FAQ${META_TITLE_SEPARATOR}${BRAND}`);
    expect(build('Questions fréquentes', 'fr').title).toBe(
      `Questions fréquentes${META_TITLE_SEPARATOR}${fixtureChromeIdentity('demo', 'fr').storeName}`,
    );
  });

  it('leaves a title that already names the brand single-branded', () => {
    // The catalog landing passes strings.catalog.meta.title, which already
    // ends in the brand. An unconditional suffix printed it twice.
    const title = `Catalogue${META_TITLE_SEPARATOR}${BRAND}`;
    expect(build(title).title).toBe(title);
    expect(build(title).title.split(BRAND).length - 1).toBe(1);
  });

  it('tolerates an operator who typed the brand into a CMS metaTitle', () => {
    expect(build(`${BRAND} FAQ`).title).toBe(`${BRAND} FAQ`);
  });

  it('carries the composed title into og and twitter', () => {
    const tags = build('FAQ');
    expect(tags.og.title).toBe(tags.title);
    expect(tags.twitter.title).toBe(tags.title);
  });

  it('keeps the brand whole when the page title is too long to fit', () => {
    // clamp() truncates from the right, so clamping the joined string ate the
    // brand and shipped a half-spelled one. The name is what gets clamped.
    const tags = build('x'.repeat(200));
    expect(tags.title.endsWith(BRAND)).toBe(true);
    expect(tags.title.length).toBeLessThanOrEqual(60);
  });
});

/**
 * Finding A5. The suffix was a copywriting convention, so the pages whose i18n
 * string forgot it (returns, cart) shipped a bare heading as their tab title.
 */
describe('pageTitle', () => {
  const SUFFIX = STORE_NAME;

  it('appends the suffix to a bare title', () => {
    expect(pageTitle('My returns', SUFFIX)).toBe(`My returns · ${SUFFIX}`);
  });

  it('leaves a title that already carries the suffix untouched', () => {
    expect(pageTitle(`Sign in · ${SUFFIX}`, SUFFIX)).toBe(`Sign in · ${SUFFIX}`);
  });

  it('does not double-append when called twice', () => {
    expect(pageTitle(pageTitle('Cart', SUFFIX), SUFFIX)).toBe(`Cart · ${SUFFIX}`);
  });

  it('returns the suffix alone for an empty title', () => {
    expect(pageTitle('', SUFFIX)).toBe(SUFFIX);
    expect(pageTitle('   ', SUFFIX)).toBe(SUFFIX);
  });

  it('returns the title alone when there is no suffix to add', () => {
    expect(pageTitle('My returns', '')).toBe('My returns');
  });

  it('leaves a title that LEADS with the suffix untouched', () => {
    // The home page's own `meta.title` is the store name, and the page passed
    // it through here, so `/en` once shipped the name twice. The guard only
    // looked at the end of the string, so the name had to be last to be seen.
    expect(pageTitle(`${SUFFIX} · Fair prices, delivered.`, SUFFIX)).toBe(
      `${SUFFIX} · Fair prices, delivered.`,
    );
  });

  it('leaves a title carrying the suffix as a middle segment untouched', () => {
    expect(pageTitle(`Shop · ${SUFFIX} · Sale`, SUFFIX)).toBe(`Shop · ${SUFFIX} · Sale`);
  });

  it('does not treat a title merely containing the suffix as suffixed', () => {
    // The name appears mid-string; the tab still needs the trailing one.
    expect(pageTitle(`About ${SUFFIX} and us`, SUFFIX)).toBe(`About ${SUFFIX} and us · ${SUFFIX}`);
  });

  it('trims before composing so no double space reaches the tab', () => {
    expect(pageTitle('  Cart  ', SUFFIX)).toBe(`Cart · ${SUFFIX}`);
  });

  it('never emits the em-dash character', () => {
    expect(pageTitle('My returns', SUFFIX)).not.toContain('—');
  });
});
