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
 * Phase SH5 — About page SSR raw-HTML journey.
 *
 * Asserts AC-5 (about row) from `specs/features/storefront-ssr-data-hydration/spec.md`:
 * the about page emits CMS-backed primary content + canonical + hreflang
 * triplet + OG block in the SSR HTML payload (no static-i18n fallback flash on
 * first paint). Closes the about-route migration to the page-server-endpoint
 * pattern via `request.get(...)` — no JS execution, no browser engine, runs on
 * every Playwright project including mobile-safari per clarifications §1.9.
 *
 * Seed comes from `scripts/seed-storefront-test.ts` via globalSetup (the CMS
 * `cms_pages` rows seed at `apps/api/src/database/seed-storefront-test.ts`).
 *
 * No axe sweep here — pure HTTP-layer test. The WCAG 2.2 AA gate for the
 * rendered about route is covered by the about-page unit spec's axe-core
 * assertion which runs inside Vitest.
 */

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

describeEveryLocale('storefront SH5 about SSR — raw HTML', (locale) => {
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
  test(`/${locale}/about SSR HTML satisfies AC-5 (about row)`, async ({ request }) => {
    const res = await request.get(`/${locale}/about`);
    expect(res.status()).toBe(200);
    const html = await res.text();

    // ── AC-5 (a): primary content selector — heading + body present ──
    // Defect: pre-SH5 the page rendered the static-i18n `strings.about.*`
    // values; SH5 sources from `/v1/pages/about`. The CMS-backed render
    // emits a populated `<h1 id="about-heading">` plus a body element with
    // non-empty content on first byte. The body element is a `<div>` since
    // commit a9034fd1 ("CMS WYSIWYG → storefront rendering"): admin authors
    // via TranslatableRichTextComponent (sanitised HTML), so the storefront
    // renders via `[innerHTML]` rather than interpolating plain text into a
    // `<p>`, which would leak literal `<p>` / `<strong>` tags as visible text.
    expect(html, 'about-heading id missing from SSR HTML — AC-5 regression').toContain(
      'id="about-heading"',
    );
    // Both classes, not the exact attribute value: `body` is the page's own
    // layout hook and `rich-text-content` is the global typography the
    // [innerHTML] children need, since a component-scoped rule cannot reach
    // them. Pinning the attribute verbatim broke the moment the second class
    // landed, and pinning only `body` would not notice it going away.
    expect(html, 'about page body class missing from SSR HTML — AC-5 regression').toMatch(
      /<div[^>]+class="[^"]*\bbody\b[^"]*"[^>]*>[\s\S]+?<\/div>/,
    );
    expect(html, 'about body lost the shared rich-text typography class').toMatch(
      /<div[^>]+class="[^"]*\brich-text-content\b[^"]*"/,
    );

    // ── AC-5 (b): canonical + hreflang triplet ──
    // staticPageMetaTags() emits canonical + alternate hreflang for both supported
    // locales plus x-default. Verifies the seo-geo.md SSR contract row for the
    // about page.
    const canonicalMatch = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/);
    expect(canonicalMatch?.[1] ?? '', 'canonical missing from about SSR HTML').toContain(
      `/${locale}/about`,
    );
    // Region tail comes from the shared matrix, never restated here. It
    // moved once at D8 and six specs like this one kept the old value,
    // which is what a second copy of a constant is for.
    for (const supported of STOREFRONT_LOCALES) {
      expect(html).toMatch(
        new RegExp(`rel="alternate"\\s+hreflang="${copyFor(STOREFRONT_HREFLANGS, supported)}"`),
      );
    }
    expect(html).toMatch(/rel="alternate"\s+hreflang="x-default"/);

    // ── AC-5 (c): OG block emits og:type='website' + locale + canonical ──
    expect(extractMetaContent(html, 'og:type')).toBe('website');
    expect(extractMetaContent(html, 'og:locale')).toBe(ogLocale);
    expect(extractMetaContent(html, 'og:title')).toBeTruthy();
    expect(extractMetaContent(html, 'og:description')).toBeTruthy();
    expect(extractMetaContent(html, 'og:url') ?? '').toContain(`/${locale}/about`);
    expect(extractMetaContent(html, 'twitter:card')).toBe('summary_large_image');

    // ── AC-5 (d): Organization + BreadcrumbList JSON-LD parse ──
    // Per `agent_docs/storefront/seo-geo.md` `## SSR contract` row for
    // `/{locale}/about`. The component emits both via applyJsonLd() in
    // ngOnInit so the structured-data payload lands in the SSR HTML on first
    // byte (no JS execution required).
    const blocks = extractAllJsonLd(html) as Array<Record<string, unknown>>;
    const types = new Set(blocks.map((b) => String(b['@type'] ?? '')));
    expect(types.has('Organization'), 'Organization JSON-LD missing from about SSR HTML').toBe(
      true,
    );
    expect(types.has('BreadcrumbList'), 'BreadcrumbList JSON-LD missing from about SSR HTML').toBe(
      true,
    );

    const breadcrumb = blocks.find((b) => b['@type'] === 'BreadcrumbList') as
      | Record<string, unknown>
      | undefined;
    const items = breadcrumb!['itemListElement'] as Array<Record<string, unknown>>;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(2);
    // First item is the locale-prefixed home URL; second is the about page.
    expect(String(items[0]['item'] ?? '')).toMatch(new RegExp(`/${locale}/`));
    expect(String(items[items.length - 1]['item'] ?? '')).toContain(`/${locale}/about`);
  });
});
