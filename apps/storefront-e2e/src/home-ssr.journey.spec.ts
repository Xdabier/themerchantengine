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
 * Phase SH3 — Home page SSR raw-HTML journey.
 *
 * Asserts AC-4 from `specs/features/storefront-ssr-data-hydration/spec.md`:
 * the home page emits populated rails + categories grid in the SSR HTML
 * payload (no empty-section flash on first paint), plus the static OG block
 * + Organization / WebSite / BreadcrumbList JSON-LD. Closes Defect B (empty-
 * section flash) by exercising the `index.server.ts` page server endpoint
 * via `request.get(...)` — no JS execution, no browser engine, runs on every
 * Playwright project including mobile-safari per clarifications §1.9.
 *
 * Seed comes from `scripts/seed-storefront-test.ts` via globalSetup.
 *
 * No axe sweep here — this is a pure HTTP-layer test (`request.get`, no
 * browser engine), so it cannot execute axe-core. The WCAG 2.2 AA gate for
 * the rendered home route is covered by `home.journey.spec.ts`'s
 * "axe — zero serious / critical violations on /fr/ and /en/" test, which
 * runs on every Playwright project including mobile-safari.
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

describeEveryLocale('storefront SH3 home SSR — raw HTML', (locale) => {
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
  test(`/${locale}/ SSR HTML satisfies AC-4 + JSON-LD payload set`, async ({ request }) => {
    const res = await request.get(`/${locale}/`);
    expect(res.status()).toBe(200);
    const html = await res.text();

    // ── AC-4 (a): categories grid populated on first byte ──
    // The categories grid section ships an empty-state message when
    // categories.length === 0. That fallback must NOT be present in the
    // SSR HTML — Defect B's failure mode was rails + grid rendering empty
    // until the browser hydration fetch resolved.
    expect(html, 'home-categories container missing from SSR HTML — AC-4 regression').toContain(
      'data-testid="home-categories"',
    );
    expect(
      html,
      'home-categories-empty must not surface in SSR HTML — Defect B regression',
    ).not.toContain('data-testid="home-categories-empty"');

    // At least one category tile must render with a locale-prefixed href.
    const categoryTileMatches = html.match(
      new RegExp(`data-testid="home-category-[a-z0-9-]+"`, 'g'),
    );
    expect(
      categoryTileMatches?.length ?? 0,
      'expected ≥ 1 home-category-<slug> tile in SSR HTML',
    ).toBeGreaterThanOrEqual(1);

    // ── AC-4 (b): ≥ 1 populated curated rail in the SSR HTML ──
    // B3 deleted the four hardcoded rails. FEATURED_PRODUCTS sections are the
    // only product rails left and their testid carries the section id, so match
    // the prefix. A populated rail emits product anchors; an empty one emits a
    // `<rail-id>-empty` child instead.
    const railIds = [
      ...new Set(
        [...html.matchAll(/data-testid="(home-featured-[A-Za-z0-9_-]+)"/g)].map((m) => m[1]!),
      ),
    ];
    expect(railIds.length, 'expected ≥ 1 home-featured-* rail in SSR HTML').toBeGreaterThanOrEqual(
      1,
    );
    const populatedRails = railIds.filter((id) => !html.includes(`data-testid="${id}-empty"`));
    expect(
      populatedRails.length,
      `expected ≥ 1 of [${railIds.join(', ')}] populated in SSR HTML`,
    ).toBeGreaterThanOrEqual(1);

    // Confirm at least one product anchor renders against the active locale.
    const productAnchorMatches = html.match(
      new RegExp(`href="/${locale}/catalog/product/[a-z0-9-]+"`, 'g'),
    );
    expect(
      productAnchorMatches?.length ?? 0,
      `expected ≥ 1 /${locale}/catalog/product/* anchor in SSR HTML`,
    ).toBeGreaterThanOrEqual(1);

    // ── AC-4 (c): OG block emits og:type='website' + locale + canonical ──
    expect(extractMetaContent(html, 'og:type')).toBe('website');
    expect(extractMetaContent(html, 'og:locale')).toBe(ogLocale);
    expect(extractMetaContent(html, 'og:title')).toBeTruthy();
    expect(extractMetaContent(html, 'og:description')).toBeTruthy();
    expect(extractMetaContent(html, 'og:url')).toContain(`/${locale}/`);
    expect(extractMetaContent(html, 'twitter:card')).toBe('summary_large_image');

    // ── AC-4 (d): JSON-LD Organization + WebSite + BreadcrumbList parse ──
    const blocks = extractAllJsonLd(html) as Array<Record<string, unknown>>;
    const types = new Set(blocks.map((b) => String(b['@type'] ?? '')));
    expect(types.has('Organization'), 'Organization JSON-LD missing from SSR HTML').toBe(true);
    expect(types.has('WebSite'), 'WebSite JSON-LD missing from SSR HTML').toBe(true);
    expect(types.has('BreadcrumbList'), 'BreadcrumbList JSON-LD missing from SSR HTML').toBe(true);

    const breadcrumb = blocks.find((b) => b['@type'] === 'BreadcrumbList') as
      | Record<string, unknown>
      | undefined;
    const items = breadcrumb!['itemListElement'] as Array<Record<string, unknown>>;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(1);
    // Locale-prefixed home URL per S23.4 sitemap shape.
    expect(String(items[0]['item'] ?? '')).toMatch(new RegExp(`/${locale}/`));

    // ── Hreflang triplet present in SSR HTML ──
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
});
