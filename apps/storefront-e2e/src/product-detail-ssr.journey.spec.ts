import { expect, test } from '@playwright/test';

import {
  STOREFRONT_OG_LOCALES,
  activeStoreConfigFixture,
  attachConsoleBaseline,
  copyFor,
  describeEveryLocale,
  type ConsoleBaseline,
} from './support';

/**
 * Phase SH2 — Product detail SSR raw-HTML journey.
 *
 * Asserts AC-1 / AC-2 / AC-3 from `specs/features/storefront-ssr-data-hydration/spec.md`
 * by issuing `request.get(...)` against the SSR pipeline and parsing the response
 * body with regex (no JS execution, no browser engine — engine-agnostic per
 * clarifications §1.9). Closes Defect A (social-share previews showing the
 * favicon instead of the product image).
 *
 * The seed comes from `scripts/seed-storefront-test.ts` via globalSetup; the
 * slug is discovered from `/sitemap-products.xml` so the assertions are
 * seed-agnostic and survive any future seed slug change.
 */

const BRAND_FALLBACK_IMAGE_PATTERNS = [
  /\/brand\/fixture-catalogue-08-mark-only\.png$/,
  /\/brand\/fixture-catalogue-07-bilingual-vertical\.png$/,
];

function extractMetaContent(html: string, propertyOrName: string): string | null {
  const propertyOrder = new RegExp(
    `<meta\\s+[^>]*property="${propertyOrName}"[^>]*content="([^"]*)"`,
    'i',
  );
  const contentOrder = new RegExp(
    `<meta\\s+[^>]*content="([^"]*)"[^>]*property="${propertyOrName}"`,
    'i',
  );
  const nameOrder = new RegExp(`<meta\\s+[^>]*name="${propertyOrName}"[^>]*content="([^"]*)"`, 'i');
  const nameContentOrder = new RegExp(
    `<meta\\s+[^>]*content="([^"]*)"[^>]*name="${propertyOrName}"`,
    'i',
  );
  return (
    html.match(propertyOrder)?.[1] ??
    html.match(contentOrder)?.[1] ??
    html.match(nameOrder)?.[1] ??
    html.match(nameContentOrder)?.[1] ??
    null
  );
}

function extractAllJsonLd(html: string): unknown[] {
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  const out: unknown[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Skip malformed payloads — assertion checks parse-validity by
      // confirming the expected @type entries are present in the parsed list.
    }
  }
  return out;
}

describeEveryLocale('storefront SH2 product detail SSR — raw HTML', (locale) => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  const ogLocale = copyFor(STOREFRONT_OG_LOCALES, locale);
  test(`/${locale}/catalog/product/<slug> SSR HTML satisfies AC-1 / AC-2 / AC-3`, async ({
    request,
  }) => {
    // Seed-agnostic slug discovery via the products sitemap (mirrors the
    // pattern in seo.journey.spec.ts S24.14 tests).
    const sitemapRes = await request.get('/sitemap-products.xml');
    expect(sitemapRes.status()).toBe(200);
    const xml = await sitemapRes.text();
    const slugMatch = xml.match(
      new RegExp(`<loc>([^<]*\\/${locale}\\/catalog\\/product\\/([^<]+))<\\/loc>`),
    );
    expect(slugMatch, 'Expected at least one product entry in sitemap').not.toBeNull();
    const productUrl = slugMatch![1];
    const productPath = new URL(productUrl).pathname;

    // Raw SSR HTML — no browser engine, no JS execution.
    const res = await request.get(productPath);
    expect(res.status()).toBe(200);
    const html = await res.text();

    // ── AC-1: og:image is the product variant URL, NEVER the favicon ──
    const ogImage = extractMetaContent(html, 'og:image');
    expect(ogImage, 'og:image meta tag missing from SSR HTML').not.toBeNull();
    expect(ogImage).toMatch(/^https?:\/\//);
    for (const fallbackPattern of BRAND_FALLBACK_IMAGE_PATTERNS) {
      expect(
        ogImage!,
        `og:image must not fall back to the brand mark (Defect A): ${ogImage}`,
      ).not.toMatch(fallbackPattern);
    }

    // ── AC-2: full Open Graph block ──
    expect(extractMetaContent(html, 'og:title')).toBeTruthy();
    expect(extractMetaContent(html, 'og:description')).toBeTruthy();
    expect(extractMetaContent(html, 'og:type')).toBe('product');
    expect(extractMetaContent(html, 'og:locale')).toBe(ogLocale);
    expect(extractMetaContent(html, 'og:url')).toMatch(new RegExp(`/${locale}/catalog/product/`));
    // Twitter card pairs with the OG block.
    expect(extractMetaContent(html, 'twitter:card')).toBe('summary_large_image');
    expect(extractMetaContent(html, 'twitter:image')).toBe(ogImage);
    // product:* facets per AC-2 — price + currency + availability surface
    // through the OG block so social-share previews carry buying signals.
    expect(extractMetaContent(html, 'product:price:amount')).toMatch(/^\d+(\.\d+)?$/);
    expect(extractMetaContent(html, 'product:price:currency')).toBe(
      activeStoreConfigFixture().money.currencyCode,
    );
    expect(extractMetaContent(html, 'product:availability')).toMatch(/^(in stock|out of stock)$/);

    // ── AC-3: Product + BreadcrumbList JSON-LD parse + carry required fields ──
    const blocks = extractAllJsonLd(html) as Array<Record<string, unknown>>;
    expect(
      blocks.length,
      'Expected at least Product + BreadcrumbList JSON-LD',
    ).toBeGreaterThanOrEqual(2);

    const product = blocks.find((b) => b['@type'] === 'Product') as
      | Record<string, unknown>
      | undefined;
    expect(product, 'Product JSON-LD block missing').toBeDefined();
    expect(product!['name']).toBeTruthy();
    expect(product!['description']).toBeTruthy();
    expect(Array.isArray(product!['image'])).toBe(true);
    expect((product!['image'] as unknown[]).length).toBeGreaterThan(0);
    const offers = product!['offers'] as Record<string, unknown> | undefined;
    expect(offers, 'Product.offers missing').toBeDefined();
    expect(offers!['@type']).toBe('Offer');
    expect(offers!['priceCurrency']).toBeTruthy();
    expect(offers!['price']).toBeTruthy();
    expect(offers!['availability']).toMatch(/^https:\/\/schema\.org\/(InStock|OutOfStock)$/);

    const breadcrumb = blocks.find((b) => b['@type'] === 'BreadcrumbList') as
      | Record<string, unknown>
      | undefined;
    expect(breadcrumb, 'BreadcrumbList JSON-LD block missing').toBeDefined();
    const items = breadcrumb!['itemListElement'] as Array<Record<string, unknown>>;
    expect(Array.isArray(items)).toBe(true);
    // AC-3: chain is home → catalog → category → product (4 items), or
    // home → catalog → product (3 items) when the seed product has no
    // primary category. Always ≥ 3.
    expect(items.length).toBeGreaterThanOrEqual(3);
    // The chain must include both the catalog landing page and the
    // product surface itself per the corrected sitemap shape (S23.4).
    const itemUrls = items.map((i) => String(i['item'] ?? ''));
    expect(itemUrls.some((u) => u.endsWith(`/${locale}/catalog`))).toBe(true);
    expect(itemUrls.some((u) => u.includes(`/${locale}/catalog/product/`))).toBe(true);
    // Each breadcrumb item URL is locale-prefixed per S23.4.
    for (const item of items) {
      expect(item['@type']).toBe('ListItem');
      expect(typeof item['name']).toBe('string');
      expect(item['item']).toMatch(new RegExp(`/${locale}/`));
    }

    // ── SSR populated-content gate (quality-gates.md "## SSR populated-content gate") ──
    // The product detail container must be in the SSR HTML, not behind a hydrate gate.
    expect(html, 'Primary content selector missing from SSR HTML').toContain(
      'data-testid="product-detail-page"',
    );
  });
});
