import { expect, test } from '@playwright/test';

import {
  STOREFRONT_API_BASE,
  STOREFRONT_HREFLANGS,
  STOREFRONT_LOCALES,
  STOREFRONT_OG_LOCALES,
  attachConsoleBaseline,
  copyFor,
  describeEveryLocale,
  type ConsoleBaseline,
} from './support';

/**
 * Phase SH4 — Category detail SSR raw-HTML journey.
 *
 * Asserts AC-5 (category row) from `specs/features/storefront-ssr-data-hydration/spec.md`:
 * the category detail page emits the resolved category copy + a populated
 * product grid + a BreadcrumbList JSON-LD chain home → catalog → category in
 * the SSR HTML payload. Closes the category-side defect-B regression by
 * exercising the `[slug].server.ts` page-server-endpoint via
 * `request.get(...)` — no JS execution, no browser engine, runs on every
 * Playwright project including mobile-safari per clarifications §1.9.
 *
 * The category slug is discovered from `/sitemap-categories.xml` so the
 * assertions are seed-agnostic and survive any future seed slug change.
 */

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

describeEveryLocale('storefront SH4 category detail SSR — raw HTML', (locale) => {
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
  test(`/${locale}/catalog/<slug> SSR HTML satisfies AC-5 (category row)`, async ({ request }) => {
    // Seed-agnostic slug discovery via the categories sitemap.
    const sitemapRes = await request.get('/sitemap-categories.xml');
    expect(sitemapRes.status()).toBe(200);
    const xml = await sitemapRes.text();
    const slugMatch = xml.match(new RegExp(`<loc>([^<]*\\/${locale}\\/catalog\\/([^<]+))<\\/loc>`));
    expect(slugMatch, 'expected at least one category entry in sitemap').not.toBeNull();
    const categoryUrl = slugMatch![1];
    const categoryPath = new URL(categoryUrl).pathname;

    const res = await request.get(categoryPath);
    expect(res.status()).toBe(200);
    const html = await res.text();

    // ── AC-5 (a): primary content selector — populated category grid ──
    expect(html, 'catalog-grid container missing from category SSR HTML').toContain(
      'data-testid="catalog-grid"',
    );
    expect(
      html,
      'catalog-grid-empty must not surface in SSR HTML for a populated category',
    ).not.toContain('data-testid="catalog-grid-empty"');

    // ── AC-5 (b): ≥ 1 product anchor for the active locale ──
    const productAnchorMatches = html.match(
      new RegExp(`href="/${locale}/catalog/product/[a-z0-9-]+"`, 'g'),
    );
    expect(
      productAnchorMatches?.length ?? 0,
      `expected ≥ 1 /${locale}/catalog/product/* anchor in SSR HTML`,
    ).toBeGreaterThanOrEqual(1);

    // ── AC-5 (c): meta block carries the locale-resolved category name ──
    const ogTitle = extractMetaContent(html, 'og:title');
    expect(ogTitle, 'og:title missing from category SSR HTML').toBeTruthy();
    expect(extractMetaContent(html, 'og:locale')).toBe(ogLocale);
    expect(extractMetaContent(html, 'og:url')).toMatch(new RegExp(`/${locale}/catalog/`));

    // ── AC-5 (d): BreadcrumbList JSON-LD chain home → catalog → category ──
    const blocks = extractAllJsonLd(html) as Array<Record<string, unknown>>;
    const breadcrumb = blocks.find((b) => b['@type'] === 'BreadcrumbList') as
      | Record<string, unknown>
      | undefined;
    expect(breadcrumb, 'BreadcrumbList JSON-LD missing from category SSR HTML').toBeDefined();
    const items = breadcrumb!['itemListElement'] as Array<Record<string, unknown>>;
    expect(Array.isArray(items)).toBe(true);
    // Chain: home → catalog → <category>. ≥ 3 items.
    expect(items.length).toBeGreaterThanOrEqual(3);
    const itemUrls = items.map((i) => String(i['item'] ?? ''));
    expect(itemUrls.some((u) => u.endsWith(`/${locale}/catalog`))).toBe(true);
    // The category leaf URL is locale-prefixed per S23.4.
    for (const item of items) {
      expect(item['@type']).toBe('ListItem');
      expect(typeof item['name']).toBe('string');
      expect(item['item']).toMatch(new RegExp(`/${locale}/`));
    }

    // ── AC-5 (e): canonical + hreflang triplet ──
    expect(html).toMatch(/<link[^>]+rel="canonical"[^>]+href="[^"]+"/);
    // Region tail comes from the shared matrix, never restated here. It
    // moved once at D8 and six specs like this one kept the old value,
    // which is what a second copy of a constant is for.
    for (const supported of STOREFRONT_LOCALES) {
      expect(html).toMatch(
        new RegExp(`rel="alternate"\\s+hreflang="${copyFor(STOREFRONT_HREFLANGS, supported)}"`),
      );
    }
    expect(html).toMatch(/rel="alternate"\s+hreflang="x-default"/);
  });

  // Hard 404 status assertion deliberately omitted — the Vite dev pipeline
  // does not cascade `createError({statusCode: 404})` from the page-server-
  // endpoint into the HTTP response (matches the SH2 product-detail-ssr
  // precedent). The 404 contract is enforced by code review against the
  // `.server.ts` body + the production-build LHCI gate landing in SH6.
});

/**
 * Phase B7 — an uploaded category image reaches all three customer surfaces
 * (findings S5 / H4 / D6, operator requirement #3).
 *
 * The test reads the live category tree and drives its assertions off whatever
 * the API actually resolved, so it mutates nothing and needs no cleanup. When
 * this environment's seed found no category image files to ingest, the
 * assertions fall back to the glyph contract rather than skipping: a tile is
 * never allowed to be an empty media box.
 *
 * The three surfaces are the home tile, the category page header and the
 * catalog chip. Before B7 the API returned no `imageUrl` at all and none of
 * them had an image element to find.
 */
describeEveryLocale('storefront B7 category images — three surfaces', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`GET /v1/categories always carries the imageUrl key (${locale})`, async ({ request }) => {
    // The hydration contract, asserted independently of whether this
    // environment's seed found any category image files to ingest: the key
    // must be present on every row, even when its value is null.
    const res = await request.get(`${STOREFRONT_API_BASE}/v1/categories`, {
      headers: { 'Accept-Language': locale },
    });
    expect(res.status()).toBe(200);
    const rows = ((await res.json()) as { data: Array<Record<string, unknown>> }).data;
    expect(rows.length).toBeGreaterThan(0);

    const walk = (nodes: Array<Record<string, unknown>>): void => {
      for (const node of nodes) {
        expect(node, `category ${String(node['slug'])}`).toHaveProperty('imageUrl');
        expect(node).not.toHaveProperty('image');
        if (Array.isArray(node['children'])) {
          walk(node['children'] as Array<Record<string, unknown>>);
        }
      }
    };
    walk(rows);
  });

  test(`a category with an image renders it on the header and the chip (${locale})`, async ({
    page,
    request,
  }) => {
    const list = await request.get(`${STOREFRONT_API_BASE}/v1/categories`, {
      headers: { 'Accept-Language': locale },
    });
    expect(list.status()).toBe(200);
    const roots = ((await list.json()) as { data: Array<Record<string, unknown>> }).data;

    // Pick a root category that already resolves an image. When the seed
    // planted none, the contract still holds through the fallback: assert the
    // tile is never an empty media box. No test.skip.
    const withImage = roots.find((c) => typeof c['imageUrl'] === 'string' && c['imageUrl']);

    if (!withImage) {
      await page.goto(`/${locale}/`);
      const tiles = page.locator('[data-testid^="home-category-"]');
      await expect(tiles.first()).toBeVisible({ timeout: 60_000 });
      const count = await tiles.count();
      for (let i = 0; i < count; i++) {
        const tile = tiles.nth(i);
        const media = await tile.locator('img, svg').count();
        expect(media, 'every tile shows either an image or a drawn glyph').toBeGreaterThan(0);
      }
      return;
    }

    const slug = withImage['slug'] as string;
    const imageUrl = withImage['imageUrl'] as string;

    // Home tile.
    await page.goto(`/${locale}/`);
    const tile = page.locator(`[data-testid="home-category-${slug}"]`);
    if ((await tile.count()) > 0) {
      await expect(tile.locator('img').first()).toHaveAttribute('src', imageUrl);
    }

    // Category page header.
    await page.goto(`/${locale}/catalog/${slug}`);
    await expect(page.locator('h1.title')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.header-media img')).toHaveAttribute('src', imageUrl);

    // Catalog chip.
    await page.goto(`/${locale}/catalog`);
    const chip = page.locator(`a.chip:has(img[src="${imageUrl}"])`);
    await expect(chip.first()).toBeVisible({ timeout: 60_000 });
  });
});
