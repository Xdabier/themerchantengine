import { expect, test } from '@playwright/test';

import { attachConsoleBaseline, describeEveryLocale, type ConsoleBaseline } from './support';

/**
 * Phase SH4 — Catalog landing SSR raw-HTML journey.
 *
 * Asserts AC-5 (catalog row) from `specs/features/storefront-ssr-data-hydration/spec.md`:
 * the catalog landing page emits a populated product grid in the SSR HTML
 * payload (no empty-grid flash on first paint), plus the expected meta + JSON-LD
 * scaffolding shared by every public route. Closes the catalog-side defect-B
 * regression by exercising the `index.server.ts` page-server-endpoint via
 * `request.get(...)` — no JS execution, no browser engine, runs on every
 * Playwright project including mobile-safari per clarifications §1.9.
 *
 * Seed comes from `scripts/seed-storefront-test.ts` via globalSetup.
 *
 * No axe sweep here — pure HTTP-layer test (`request.get`, no browser engine),
 * cannot execute axe-core. The WCAG 2.2 AA gate for the rendered catalog
 * route is covered by `catalog.journey.spec.ts`'s axe assertions which run
 * on every Playwright project.
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

describeEveryLocale('storefront SH4 catalog landing SSR — raw HTML', (locale) => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`/${locale}/catalog SSR HTML satisfies AC-5 (catalog row)`, async ({ request }) => {
    const res = await request.get(`/${locale}/catalog`);
    expect(res.status()).toBe(200);
    const html = await res.text();

    // ── AC-5 (a): primary content selector — populated catalog grid ──
    // Defect B's failure mode: the grid element absent from SSR HTML, the
    // empty-state shell rendering until browser hydrate fetched products.
    // With SH4 the page-server-endpoint seeds the page-1 products, so the
    // grid must be in the SSR HTML on first byte.
    expect(html, 'catalog-grid container missing from SSR HTML — AC-5 regression').toContain(
      'data-testid="catalog-grid"',
    );
    expect(
      html,
      'catalog-grid-empty must not surface in SSR HTML — Defect B regression',
    ).not.toContain('data-testid="catalog-grid-empty"');

    // ── AC-5 (b): ≥ 1 product anchor for the active locale ──
    const productAnchorMatches = html.match(
      new RegExp(`href="/${locale}/catalog/product/[a-z0-9-]+"`, 'g'),
    );
    expect(
      productAnchorMatches?.length ?? 0,
      `expected ≥ 1 /${locale}/catalog/product/* anchor in SSR HTML`,
    ).toBeGreaterThanOrEqual(1);

    // ── AC-5 (c): canonical + OG block ──
    // The catalog landing page calls applyMeta() via staticPageMetaTags(),
    // which sets canonical + hreflang triplet + the full OG block.
    // All three assertions verify the SSR contract from seo-geo.md line 164.
    expect(html).toMatch(/<link[^>]+rel="canonical"[^>]+href="[^"]+"/);
    const ogTitle = extractMetaContent(html, 'og:title');
    expect(ogTitle, 'og:title meta missing from catalog SSR HTML').toBeTruthy();

    // ── AC-3 / AC-5 (d): JSON-LD per seo-geo.md row 164 ──
    // BreadcrumbList (home → catalog) + ItemList over the SSR-seeded
    // page-1 products. Closes the SH7 reviewer Blocker 2 — catalog
    // landing emitted no JSON-LD before. Both blocks ride a single
    // `data-catalog-jsonld` flag so `applyJsonLd()` can clean them up
    // atomically on a future browser-side re-emit.
    const jsonLdScripts = [
      ...html.matchAll(
        /<script[^>]+type="application\/ld\+json"[^>]*data-catalog-jsonld="true"[^>]*>([\s\S]*?)<\/script>/g,
      ),
    ];
    expect(
      jsonLdScripts.length,
      'expected ≥ 2 catalog-jsonld script blocks (BreadcrumbList + ItemList) in SSR HTML',
    ).toBeGreaterThanOrEqual(2);
    const jsonLdPayloads = jsonLdScripts.map(
      (m) =>
        JSON.parse(m[1] as string) as {
          '@type': string;
        },
    );
    const breadcrumb = jsonLdPayloads.find((p) => p['@type'] === 'BreadcrumbList');
    expect(breadcrumb, 'BreadcrumbList JSON-LD missing from catalog SSR HTML').toBeTruthy();
    const itemList = jsonLdPayloads.find((p) => p['@type'] === 'ItemList') as
      | { itemListElement: { url: string }[]; numberOfItems: number }
      | undefined;
    expect(itemList, 'ItemList JSON-LD missing from catalog SSR HTML').toBeTruthy();
    expect(
      itemList!.itemListElement.length,
      'ItemList must carry ≥ 1 element from the SSR-seeded products',
    ).toBeGreaterThanOrEqual(1);
    expect(
      itemList!.itemListElement.every((entry) => entry.url.includes(`/${locale}/catalog/product/`)),
      'every ItemList entry must be a locale-prefixed product URL',
    ).toBe(true);
  });
});
