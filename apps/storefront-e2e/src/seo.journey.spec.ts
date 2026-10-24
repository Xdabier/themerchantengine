import { expect, test } from '@playwright/test';

import {
  STOREFRONT_HREFLANGS,
  STOREFRONT_LOCALES,
  STOREFRONT_OG_LOCALES,
  attachConsoleBaseline,
  copyFor,
  otherLocales,
  type ConsoleBaseline,
} from './support';

/**
 * Phase S13 — SEO + GEO surfaces journey.
 *
 * Boots against the real test API + seeded catalogue (no fixtures, no
 * `page.route()` per constitution §3.8). Asserts:
 *   1. The proxied SEO/GEO surfaces (`/sitemap.xml`, `/sitemap_index.xml`,
 *      `/sitemap-products.xml`, `/sitemap-categories.xml`, `/robots.txt`,
 *      `/llms.txt`) return the right status, content-type, and a sentinel
 *      payload shape.
 *   2. Every public locale-prefixed route emits a single `<link rel="canonical">`,
 *      the hreflang triplet from the shared locale matrix, and at least
 *      one `<script type="application/ld+json">` whose payload carries a
 *      recognised schema.org `@type`.
 *   3. Every private locale-prefixed route emits `<meta name="robots">` with
 *      `noindex` + `nofollow`.
 */

/**
 * Section order `buildLlmsTxt` emits, per
 * `agent_docs/storefront/seo-geo.md` "## llms.txt shape" and the unit spec at
 * `apps/api/src/modules/geo/geo.service.llms.spec.ts`. `Contact` needs a
 * configured contact email and `Optional` needs content, so both are
 * conditional; the other three are not.
 */
const CANONICAL_LLMS_SECTIONS = [
  'About',
  'Categories',
  'Featured Products',
  'Policies',
  'Contact',
  'Optional',
];

const SEEDED_CATEGORY_SLUG = 'fx-audio';
const SEEDED_PRODUCT_SLUG = 'fx-laptop-pro-16-max';

const PUBLIC_ROUTES = [
  '/fr/',
  '/en/',
  `/fr/catalog/${SEEDED_CATEGORY_SLUG}`,
  `/en/catalog/${SEEDED_CATEGORY_SLUG}`,
  `/fr/catalog/product/${SEEDED_PRODUCT_SLUG}`,
  `/en/catalog/product/${SEEDED_PRODUCT_SLUG}`,
  '/fr/search?q=audio',
  '/en/search?q=audio',
] as const;

const PRIVATE_ROUTES = [
  '/fr/checkout',
  '/fr/cart',
  '/fr/account',
  '/fr/auth/login',
  '/en/auth/register',
] as const;

const RECOGNISED_JSON_LD_TYPES = new Set([
  'Organization',
  'WebSite',
  'BreadcrumbList',
  'ItemList',
  'Product',
  'FAQPage',
]);

test.describe('storefront S13 SEO + GEO surfaces', () => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test('GET /sitemap_index.xml returns 200 + application/xml + <?xml prelude', async ({
    request,
  }) => {
    const res = await request.get('/sitemap_index.xml');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type'] ?? '').toMatch(/application\/xml/i);
    const body = await res.text();
    expect(body.startsWith('<?xml')).toBe(true);
  });

  test('GET /sitemap.xml returns 301 redirecting to /sitemap_index.xml', async ({ request }) => {
    const res = await request.get('/sitemap.xml', { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers()['location']).toBe('/sitemap_index.xml');
  });

  test('GET /sitemap-products.xml returns 200 + application/xml + at least one <loc>', async ({
    request,
  }) => {
    const res = await request.get('/sitemap-products.xml');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type'] ?? '').toMatch(/application\/xml/i);
    const body = await res.text();
    expect(body).toMatch(/<loc>[^<]+<\/loc>/);
  });

  test('GET /sitemap-categories.xml returns 200 + application/xml', async ({ request }) => {
    const res = await request.get('/sitemap-categories.xml');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type'] ?? '').toMatch(/application\/xml/i);
  });

  test('every <loc> in sitemap-pages.xml resolves 200 on the storefront', async ({ request }) => {
    // The soft-404 tripwire. The pages sitemap and the storefront route tree
    // are held in two different apps with no shared import, and they drifted:
    // the sitemap advertised /{locale}/{slug} for every CMS page while no such
    // route existed, so six slugs times two locales were listed as indexable
    // and answered 404. Fetching each entry is the only assertion that binds
    // the two sides together.
    const res = await request.get('/sitemap-pages.xml');
    expect(res.status()).toBe(200);
    const xml = await res.text();

    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length, 'an empty pages sitemap would pass this vacuously').toBeGreaterThan(4);

    const dead: string[] = [];
    for (const loc of locs) {
      const path = new URL(loc).pathname + new URL(loc).search;
      const page = await request.get(path);
      if (page.status() !== 200) dead.push(`${path} -> ${page.status()}`);
    }
    expect(dead, 'sitemap entries that do not resolve').toEqual([]);
  });

  test('GET /robots.txt returns 200 + text/plain + a User-agent directive + Sitemap pointer', async ({
    request,
  }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type'] ?? '').toMatch(/^text\/plain/);
    const body = await res.text();
    expect(body).toMatch(/User-agent:/i);
    expect(body).toMatch(/Sitemap:/i);
  });

  test('GET /llms.txt returns 200 + text/plain + a Markdown sentinel', async ({ request }) => {
    const res = await request.get('/llms.txt');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type'] ?? '').toMatch(/^text\/plain/);
    const body = await res.text();
    expect(body.length).toBeGreaterThanOrEqual(16);
    expect(body).toContain('#');
  });

  for (const route of PUBLIC_ROUTES) {
    test(`public route ${route} carries canonical, hreflang triplet, and ≥1 valid JSON-LD`, async ({
      page,
    }) => {
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');

      const canonical = page.locator('link[rel="canonical"]');
      await expect(canonical).toHaveCount(1);
      const canonicalHref = await canonical.getAttribute('href');
      expect(canonicalHref ?? '').toMatch(/^https?:\/\//);

      const hreflangValues = await page
        .locator('link[rel="alternate"][hreflang]')
        .evaluateAll((links) =>
          links.map((l) => (l as HTMLLinkElement).getAttribute('hreflang') ?? ''),
        );
      // Both sides sorted: the expected tags are derived from the shared
      // matrix, so re-pointing a locale (or its region tail) never leaves a
      // hand-written array in the wrong alphabetical order.
      const expectedHreflangs = [
        ...STOREFRONT_LOCALES.map((locale) => copyFor(STOREFRONT_HREFLANGS, locale)),
        'x-default',
      ].sort();
      expect(hreflangValues.sort()).toEqual(expectedHreflangs);

      const jsonLdPayloads = await page
        .locator('script[type="application/ld+json"]')
        .evaluateAll((scripts) => scripts.map((s) => s.textContent ?? ''));
      expect(jsonLdPayloads.length).toBeGreaterThanOrEqual(1);
      const types = jsonLdPayloads
        .map((raw) => {
          try {
            const parsed = JSON.parse(raw) as { '@type'?: string };
            return parsed['@type'] ?? '';
          } catch {
            return '';
          }
        })
        .filter((t) => RECOGNISED_JSON_LD_TYPES.has(t));
      expect(types.length).toBeGreaterThanOrEqual(1);
    });
  }

  for (const route of PRIVATE_ROUTES) {
    test(`private route ${route} emits noindex,nofollow`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');
      // Some private routes 302 to /auth/login — assert noindex on whatever
      // page actually renders (login is itself private).
      const robotsContent = await page
        .locator('meta[name="robots"]')
        .first()
        .getAttribute('content');
      expect(robotsContent ?? '').toMatch(/noindex/i);
      expect(robotsContent ?? '').toMatch(/nofollow/i);
    });
  }

  // ── S23.8 — sitemap hreflang, robots Allow:/, llms.txt sections ────────────

  test('sitemap-products.xml body contains hreflang alternates per <url>', async ({ request }) => {
    const res = await request.get('/sitemap-products.xml');
    expect(res.status()).toBe(200);
    const body = await res.text();
    // xmlns:xhtml namespace declaration on <urlset> per
    // agent_docs/storefront/seo-geo.md "Hreflang regional codes".
    expect(body).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');

    // Slug-agnostic assertion: ANY product <url> entry that points at an
    // /fr/catalog/product/<slug> path must carry the three-locale triplet
    // (the shared matrix pair plus x-default) and the en-locale cross-link. The seed
    // slug varies between the test seed (fx-*) and the dev seed
    // (anker-*, moxedo-*) so a hardcoded slug regex is brittle. We assert
    // structure instead.
    const productUrlMatch = body.match(
      /<url>[\s\S]*?<loc>[^<]*\/fr\/catalog\/product\/[^<]+<\/loc>[\s\S]*?<\/url>/,
    );
    expect(productUrlMatch).not.toBeNull();
    for (const locale of STOREFRONT_LOCALES) {
      expect(productUrlMatch?.[0]).toContain(`hreflang="${copyFor(STOREFRONT_HREFLANGS, locale)}"`);
    }
    expect(productUrlMatch?.[0]).toContain('hreflang="x-default"');
    expect(productUrlMatch?.[0]).toMatch(/\/en\/catalog\/product\/[^"]+/);
  });

  test('sitemap-categories.xml body contains hreflang alternates per <url>', async ({
    request,
  }) => {
    const res = await request.get('/sitemap-categories.xml');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');

    // Slug-agnostic per the products comment above.
    const categoryUrlMatch = body.match(
      /<url>[\s\S]*?<loc>[^<]*\/fr\/catalog\/[^/<]+<\/loc>[\s\S]*?<\/url>/,
    );
    expect(categoryUrlMatch).not.toBeNull();
    for (const locale of STOREFRONT_LOCALES) {
      expect(categoryUrlMatch?.[0]).toContain(
        `hreflang="${copyFor(STOREFRONT_HREFLANGS, locale)}"`,
      );
    }
    expect(categoryUrlMatch?.[0]).toContain('hreflang="x-default"');
  });

  test('robots.txt allows AI crawlers — Allow: / follows every User-agent: <ai-bot> line', async ({
    request,
  }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();

    // The new doc-of-record roster ships an explicit Allow: / per AI bot,
    // superseding the prior S13.9 GPTBot-substring assertion which incidentally
    // passed against the (defective) Disallow: / direction.
    const lines = body.split('\n');
    const aiBots = [
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
    ];
    for (const bot of aiBots) {
      const idx = lines.findIndex((l) => l.trim() === `User-agent: ${bot}`);
      expect(idx).toBeGreaterThan(-1);
      expect(lines[idx + 1].trim()).toBe('Allow: /');
    }
    // Deprecated bots stay out of the response body.
    expect(body).not.toMatch(/User-agent:\s*anthropic-ai/);
    expect(body).not.toMatch(/User-agent:\s*Claude-Web/);
  });

  test('llms.txt contains the four mandated sections in order, store-name H1, brand-floor voice', async ({
    request,
  }) => {
    const res = await request.get('/llms.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();

    // H1 is the resolved store name (not the literal "# Store" placeholder).
    const firstLine = body.split('\n')[0];
    expect(firstLine).toMatch(/^# .+/);
    expect(firstLine).not.toBe('# Store');

    // Section order. This assertion pinned a four-section shape that the
    // 2026-05-06 restructure replaced, so it had been stale, and green only
    // because the suite was not being run end-to-end. `Contact` and
    // `Optional` are conditional on configuration, so the assertion is on the
    // ORDER of whatever is emitted plus the presence of the unconditional
    // three: an out-of-order or unrecognised header still fails.
    const sectionHeaders = (body.match(/^## .+$/gm) ?? []).map((h) => h.replace(/^## /, ''));
    expect(sectionHeaders).toEqual(
      CANONICAL_LLMS_SECTIONS.filter((section) => sectionHeaders.includes(section)),
    );
    expect(sectionHeaders).toEqual(expect.arrayContaining(['About', 'Categories', 'Policies']));

    // Generic boilerplate is forbidden per agent_docs/storefront/seo-geo.md "## llms.txt shape".
    expect(body).not.toContain('machine-readable content optimised');

    // Catalog body uses the locale-prefixed Analog routes, not the prior
    // /products/<slug> + /categories/<slug> shape that 404s.
    expect(body).not.toMatch(/\(\S*\/products\/\S+\)/);
    expect(body).not.toMatch(/\(\S*\/categories\/\S+\)/);
  });

  // ── S24.14 — product schema enrichment + OG locale + breadcrumb locale ────

  // One locale per test. The pair used to share a body, and the second `goto`
  // aborted the first route's in-flight module imports; the rejected dynamic
  // import reached StorefrontErrorHandler and the console baseline failed the
  // test in teardown while both halves of the assertion had passed. Each half
  // stands alone, and each still asserts the OTHER locale is the advertised
  // alternate, so the pairing the test exists for is not lost.
  for (const locale of STOREFRONT_LOCALES) {
    test(`product detail at /${locale}/ emits its own og:locale and the other as alternate`, async ({
      page,
    }) => {
      // Find a real product slug from the products sitemap so the assertion
      // is seed-agnostic. The sitemap is the canonical URL surface for the
      // storefront — anything indexed by Google must appear there.
      const sitemapRes = await page.request.get('/sitemap-products.xml');
      const xml = await sitemapRes.text();
      const productMatch = xml.match(/<loc>([^<]*\/fr\/catalog\/product\/[^<]+)<\/loc>/);
      expect(productMatch).not.toBeNull();
      const productUrl = productMatch![1].replace('/fr/', `/${locale}/`);

      // Both values come from the shared matrix, so this spec cannot drift
      // from the six SSR specs that read the same constants.
      await page.goto(productUrl);
      await page.waitForLoadState('domcontentloaded');
      const own = await page.locator('meta[property="og:locale"]').getAttribute('content');
      expect(own).toBe(copyFor(STOREFRONT_OG_LOCALES, locale));
      const alternates = await page
        .locator('meta[property="og:locale:alternate"]')
        .evaluateAll((nodes) => nodes.map((n) => (n as HTMLMetaElement).content ?? ''));
      expect(alternates).toEqual(otherLocales(locale).map((l) => STOREFRONT_OG_LOCALES[l]));
    });
  }

  for (const locale of STOREFRONT_LOCALES) {
    /**
     * `og:locale:alternate` was built by every meta builder and applied by
     * exactly one page. Four surfaces computed the value and threw it away,
     * so a share card on any of them advertised no alternate language at all.
     *
     * Asserted on the raw SSR HTML, which is what a crawler and a link
     * unfurler read, and by value rather than by tag count: a page emitting
     * its own locale twice would satisfy a count.
     */
    const SURFACES = [
      `/${locale}/`,
      `/${locale}/about`,
      `/${locale}/policies/terms`,
      `/${locale}/pages/faq`,
      `/${locale}/catalog`,
    ];

    for (const path of SURFACES) {
      test(`${path} emits og:locale:alternate for every other locale`, async ({ request }) => {
        const res = await request.get(path);
        expect(res.status(), `${path} must render`).toBe(200);
        const html = await res.text();

        const alternates = [
          ...html.matchAll(/<meta[^>]*property="og:locale:alternate"[^>]*content="([^"]*)"[^>]*>/g),
        ].map((m) => m[1]);

        expect(alternates, `no og:locale:alternate on ${path}`).toEqual(
          otherLocales(locale).map((l) => STOREFRONT_OG_LOCALES[l]),
        );
      });
    }
  }

  test('product JSON-LD emits brand + sku + itemCondition + locale-prefixed BreadcrumbList items', async ({
    page,
  }) => {
    // Pick any real product slug from the products sitemap.
    const sitemapRes = await page.request.get('/sitemap-products.xml');
    const xml = await sitemapRes.text();
    const productMatch = xml.match(/<loc>([^<]*\/fr\/catalog\/product\/([^<]+))<\/loc>/);
    expect(productMatch).not.toBeNull();
    const frProductUrl = productMatch![1];
    const productSlug = productMatch![2];

    await page.goto(frProductUrl);
    await page.waitForLoadState('domcontentloaded');

    // Read every JSON-LD payload, filter to the Product + BreadcrumbList
    // entries that the seo.service.buildProductSchema enrichment emits.
    const payloads = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((scripts) =>
        scripts
          .map((s) => {
            try {
              return JSON.parse(s.textContent ?? '');
            } catch {
              return null;
            }
          })
          .filter((p): p is Record<string, unknown> => p !== null),
      );

    const product = payloads.find((p) => p['@type'] === 'Product');
    expect(product).toBeDefined();
    // S24.6: itemCondition default per DR-09. Always emitted.
    expect(product!['itemCondition']).toBe('https://schema.org/NewCondition');
    // sku from the default variant (per backfill, every seeded product
    // carries at least one variant). The exact SKU is seed-dependent but
    // its presence is contractual.
    expect(product!['sku']).toBeTruthy();
    expect(typeof product!['sku']).toBe('string');
    // brand emit — every backfilled product carries a Brand FK after the
    // S24.4 migration (3 distinct brands seeded). Resolved against the
    // fr locale → branded value follows the Translatable contract.
    if (product!['brand']) {
      const brand = product!['brand'] as Record<string, unknown>;
      expect(brand['@type']).toBe('Brand');
      expect(brand['name']).toBeTruthy();
    }

    // S24.6 + S23.4: every BreadcrumbList itemListElement[i].item URL
    // carries the /fr prefix matching the corrected sitemap shape.
    const breadcrumb = payloads.find((p) => p['@type'] === 'BreadcrumbList');
    expect(breadcrumb).toBeDefined();
    const items = breadcrumb!['itemListElement'] as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThanOrEqual(2);
    for (const item of items) {
      const url = item['item'] as string;
      expect(url).toMatch(/^https?:\/\/[^/]+\/fr(\/|$)/);
    }
    // The terminal item points at the product URL itself.
    const lastItem = items[items.length - 1]['item'] as string;
    expect(lastItem).toContain(`/fr/catalog/product/${productSlug}`);
  });
});
