import { expect, test } from '@playwright/test';

import {
  STOREFRONT_HREFLANGS,
  STOREFRONT_LOCALES,
  STOREFRONT_OG_LOCALES,
  attachConsoleBaseline,
  copyFor,
  describeEveryLocale,
  type ConsoleBaseline,
} from './support';

/**
 * Phase SH4 — Search SSR raw-HTML journey.
 *
 * Asserts AC-5 (search row) from `specs/features/storefront-ssr-data-hydration/spec.md`:
 *  - `/{locale}/search?q=<term>` emits populated hits + meta + JSON-LD on first byte
 *  - bare `/{locale}/search` (no `?q=`) emits the empty-state CTA per
 *    clarifications Q-5 — the `load` body always executes; bare search
 *    returns the empty payload synchronously.
 *
 * Closes the search-side defect-B regression by exercising the
 * `index.server.ts` page-server-endpoint via `request.get(...)` — no JS
 * execution, no browser engine, runs on every Playwright project including
 * mobile-safari per clarifications §1.9.
 *
 * The query term "laptop" matches the fixture catalogue seed (electronics
 * products are named "the fixture catalogue <model> Laptop" in
 * `prisma/seeds/fixture-catalogue/products.ts`). It also matched the dev catalogue's
 * laptop-stand and laptop-accessory SKUs, which mattered while the suite
 * could be pointed at the dev API; plan H removed that mode, so the test
 * database is now the only target.
 */

const SEARCH_TERM = 'laptop';

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

describeEveryLocale('storefront SH4 search SSR — raw HTML', (locale) => {
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
  test(`/${locale}/search?q=${SEARCH_TERM} SSR HTML satisfies AC-5 (search row, populated)`, async ({
    request,
  }) => {
    const res = await request.get(`/${locale}/search?q=${SEARCH_TERM}`);
    expect(res.status()).toBe(200);
    const html = await res.text();

    // ── AC-5 (a): populated search results grid ──
    expect(html, 'catalog-grid container missing from search SSR HTML — AC-5 regression').toContain(
      'data-testid="catalog-grid"',
    );
    expect(
      html,
      'catalog-grid-empty must not surface in SSR HTML for a populated search',
    ).not.toContain('data-testid="catalog-grid-empty"');

    // ── AC-5 (b): ≥ 1 product anchor for the active locale ──
    const productAnchorMatches = html.match(
      new RegExp(`href="/${locale}/catalog/product/[a-z0-9-]+"`, 'g'),
    );
    expect(
      productAnchorMatches?.length ?? 0,
      `expected ≥ 1 /${locale}/catalog/product/* anchor in SSR HTML`,
    ).toBeGreaterThanOrEqual(1);

    // ── AC-5 (c): heading carries the search term ──
    expect(html).toContain('data-testid="search-title"');

    // ── AC-5 (d): meta block carries og:locale + canonical + ?q= URL ──
    expect(extractMetaContent(html, 'og:locale')).toBe(ogLocale);
    expect(extractMetaContent(html, 'og:url')).toContain(`/${locale}/search?q=${SEARCH_TERM}`);
    expect(extractMetaContent(html, 'twitter:card')).toBe('summary_large_image');

    // ── AC-5 (e): BreadcrumbList JSON-LD parses + chain has home → search ──
    const blocks = extractAllJsonLd(html) as Array<Record<string, unknown>>;
    const breadcrumb = blocks.find((b) => b['@type'] === 'BreadcrumbList') as
      | Record<string, unknown>
      | undefined;
    expect(breadcrumb, 'BreadcrumbList JSON-LD missing from search SSR HTML').toBeDefined();
    const items = breadcrumb!['itemListElement'] as Array<Record<string, unknown>>;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(2);
    const itemUrls = items.map((i) => String(i['item'] ?? ''));
    expect(itemUrls.some((u) => u.includes(`/${locale}/`))).toBe(true);
    expect(itemUrls.some((u) => u.includes(`/${locale}/search`))).toBe(true);

    // ── AC-5 (f): hreflang triplet present ──
    // Region tail comes from the shared matrix, never restated here. It
    // moved once at D8 and six specs like this one kept the old value,
    // which is what a second copy of a constant is for.
    for (const supported of STOREFRONT_LOCALES) {
      expect(html).toMatch(
        new RegExp(`rel="alternate"\\s+hreflang="${copyFor(STOREFRONT_HREFLANGS, supported)}"`),
      );
    }
    expect(html).toMatch(/rel="alternate"\s+hreflang="x-default"/);

    // ── AC-3 / AC-5 (g): ItemList JSON-LD per seo-geo.md row 167 ──
    // `/{locale}/search?q=...` requires `BreadcrumbList + ItemList (results)`.
    // Closes the SH7 reviewer Blocker 3 — search SSR was emitting only
    // BreadcrumbList before. ItemList ships only when the query produced
    // hits; bare search omits it (the bare-search test below asserts that).
    const itemList = blocks.find((b) => b['@type'] === 'ItemList') as
      | { itemListElement: Array<{ url: string; position: number }>; numberOfItems: number }
      | undefined;
    expect(itemList, 'ItemList JSON-LD missing from search SSR HTML').toBeDefined();
    expect(
      itemList!.itemListElement.length,
      'ItemList must carry ≥ 1 element from the SSR-seeded hits',
    ).toBeGreaterThanOrEqual(1);
    expect(
      itemList!.itemListElement.every((entry) => entry.url.includes(`/${locale}/catalog/product/`)),
      'every ItemList entry must be a locale-prefixed product URL',
    ).toBe(true);
  });

  test(`/${locale}/search bare SSR HTML returns the empty-state CTA (Q-5 contract)`, async ({
    request,
  }) => {
    // Bare search per clarifications Q-5 — the `load` body always executes
    // and returns the empty payload synchronously. The empty-state CTA
    // pointing at the locale home is the single populated content gate.
    const res = await request.get(`/${locale}/search`);
    expect(res.status()).toBe(200);
    const html = await res.text();

    expect(html).toContain('data-testid="search-title"');
    expect(html, 'bare search must surface the empty-state grid in SSR HTML').toContain(
      'data-testid="catalog-grid-empty"',
    );
    // No product anchors — bare search has no results to populate.
    const productAnchorMatches = html.match(
      new RegExp(`href="/${locale}/catalog/product/[a-z0-9-]+"`, 'g'),
    );
    expect(productAnchorMatches?.length ?? 0).toBe(0);

    // og:url canonical without `?q=` for bare search.
    const ogUrl = extractMetaContent(html, 'og:url');
    expect(ogUrl, 'og:url missing on bare search SSR HTML').toBeTruthy();
    expect(ogUrl).not.toContain('?q=');

    // Bare search emits BreadcrumbList only — ItemList absent because
    // there are no enumerable results. Per seo-geo.md row 167 the
    // ItemList is gated on `?q=` being present.
    const blocks = extractAllJsonLd(html) as Array<Record<string, unknown>>;
    expect(blocks.find((b) => b['@type'] === 'BreadcrumbList')).toBeDefined();
    expect(
      blocks.find((b) => b['@type'] === 'ItemList'),
      'bare search must NOT emit ItemList — no results to summarise',
    ).toBeUndefined();
  });
});
