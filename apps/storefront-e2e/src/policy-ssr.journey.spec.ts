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
 * Phase SH5 — Policy pages SSR raw-HTML journey.
 *
 * Asserts AC-5 (policies row) from `specs/features/storefront-ssr-data-hydration/spec.md`:
 * the four policy pages (privacy / returns / terms / shipping) emit CMS-backed
 * primary content + canonical + hreflang triplet + OG block in the SSR HTML
 * payload. Closes the policies-route migration to the page-server-endpoint
 * pattern. Slug map (storefront → CMS) per clarifications §1.20:
 *   - `/{locale}/policies/privacy`  → `/privacy-policy`
 *   - `/{locale}/policies/returns`  → `/return-policy`
 *   - `/{locale}/policies/terms`    → `/terms`
 *   - `/{locale}/policies/shipping` → `/shipping-info`
 *
 * Runs on every Playwright project including mobile-safari per clarifications §1.9.
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

const POLICY_SLUGS = ['privacy', 'returns', 'terms', 'shipping'] as const;

describeEveryLocale('storefront SH5 policy SSR — raw HTML', (locale) => {
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
  for (const slug of POLICY_SLUGS) {
    test(`/${locale}/policies/${slug} SSR HTML satisfies AC-5 (policies row)`, async ({
      request,
    }) => {
      const res = await request.get(`/${locale}/policies/${slug}`);
      expect(res.status()).toBe(200);
      const html = await res.text();

      // ── AC-5 (a): primary content selector — heading + body present ──
      // The body element is a `<div>` since commit a9034fd1 ("CMS WYSIWYG →
      // storefront rendering"): admin authors via TranslatableRichTextComponent
      // (sanitised HTML), so the page renders via `[innerHTML]` rather than
      // interpolating plain text into a `<p>`, which would leak literal
      // `<p>` / `<strong>` tags as visible text.
      expect(
        html,
        `policy-heading id missing from SSR HTML for /${locale}/policies/${slug}`,
      ).toContain('id="policy-heading"');
      expect(
        html,
        `policy page body class missing from SSR HTML for /${locale}/policies/${slug}`,
      ).toMatch(/<div[^>]+class="[^"]*\bbody\b[^"]*"[^>]*>[\s\S]+?<\/div>/);
      expect(
        html,
        `policy body lost the shared rich-text typography class for /${locale}/policies/${slug}`,
      ).toMatch(/<div[^>]+class="[^"]*\brich-text-content\b[^"]*"/);

      // ── AC-5 (b): canonical scoped to slug + locale ──
      const canonicalMatch = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/);
      expect(canonicalMatch?.[1] ?? '').toContain(`/${locale}/policies/${slug}`);

      // ── AC-5 (c): hreflang triplet ──
      // Region tail comes from the shared matrix, never restated here. It
      // moved once at D8 and six specs like this one kept the old value,
      // which is what a second copy of a constant is for.
      for (const supported of STOREFRONT_LOCALES) {
        expect(html).toMatch(
          new RegExp(`rel="alternate"\\s+hreflang="${copyFor(STOREFRONT_HREFLANGS, supported)}"`),
        );
      }
      expect(html).toMatch(/rel="alternate"\s+hreflang="x-default"/);

      // ── AC-5 (d): OG block ──
      expect(extractMetaContent(html, 'og:type')).toBe('website');
      expect(extractMetaContent(html, 'og:locale')).toBe(ogLocale);
      expect(extractMetaContent(html, 'og:title')).toBeTruthy();
      expect(extractMetaContent(html, 'og:url') ?? '').toContain(`/${locale}/policies/${slug}`);
      expect(extractMetaContent(html, 'twitter:card')).toBe('summary_large_image');

      // ── AC-5 (e): BreadcrumbList JSON-LD parse ──
      // Per `agent_docs/storefront/seo-geo.md` `## SSR contract` row for
      // `/{locale}/policies/{slug}`.
      const blocks = extractAllJsonLd(html) as Array<Record<string, unknown>>;
      const types = new Set(blocks.map((b) => String(b['@type'] ?? '')));
      expect(
        types.has('BreadcrumbList'),
        `BreadcrumbList JSON-LD missing from /${locale}/policies/${slug} SSR HTML`,
      ).toBe(true);
      const breadcrumb = blocks.find((b) => b['@type'] === 'BreadcrumbList') as
        | Record<string, unknown>
        | undefined;
      const items = breadcrumb!['itemListElement'] as Array<Record<string, unknown>>;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(String(items[0]['item'] ?? '')).toMatch(new RegExp(`/${locale}/`));
      expect(String(items[items.length - 1]['item'] ?? '')).toContain(
        `/${locale}/policies/${slug}`,
      );
    });
  }

  test(`/${locale}/policies/cookies (unknown slug) SSR HTML returns 404`, async ({ request }) => {
    // This used to accept `404 OR no policy heading`, which the broken build
    // satisfied through the right-hand branch: the page rendered an empty
    // shell under a 200, so the assertion passed *because* the page was
    // broken. Conjunctive now, and the status is asserted rather than
    // excused. The dev pipeline does not cascade `createError` to the
    // document; `[...not-found].page.ts` sets the status itself through
    // `injectResponse()`.
    const res = await request.get(`/${locale}/policies/cookies`);
    const html = await res.text();
    expect(res.status()).toBe(404);
    expect(html).toContain('id="not-found-heading"');
    expect(html).not.toContain('id="policy-heading"');
  });
});
