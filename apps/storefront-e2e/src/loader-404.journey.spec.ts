import { expect, test, type Page } from '@playwright/test';

import {
  attachConsoleBaseline,
  copyFor,
  describeEveryLocale,
  expectedDocumentNotFound,
  type ConsoleBaseline,
} from './support';

/**
 * The loader-404 contract, across every route that has a loader.
 *
 * A `*.server.ts` that throws `createError({ statusCode: 404 })` does not, as
 * `agent_docs/storefront/ssr-data-loading.md` used to claim, make Analog render
 * the not-found shell. Analog compiles each loader into a Nitro endpoint and
 * fetches it through a route *resolver*; a 404 rejects that resolver, which
 * cancels the navigation before activation. No route component mounts, the
 * wildcard is never reached because matching already succeeded, and the layout
 * shell renders around an empty `<main>` under a 200.
 *
 * That was live on three unbounded URL spaces. Only the policies one had a
 * browser-level test, and it had been red since the client-side redirect it
 * describes was deleted in May. The raw-HTTP probe next to it asserted
 * `status === 404 || !html.includes('policy-heading')`, which the broken build
 * satisfies through the right-hand branch, so it passed *because* the page was
 * broken. Category and product had no probe at all.
 *
 * Every assertion here is conjunctive and positive for that reason. In
 * particular `<main>` having an element child is the one that fails on the
 * empty shell, and nothing asserted it before.
 */

const HEADING = { fr: 'Page introuvable', en: 'Page not found', ar: 'الصفحة غير موجودة' } as const;

/** Per route: the URL to probe, and what the happy path would have rendered. */
const LOADER_ROUTES = [
  {
    name: 'policy',
    path: (locale: string) => `/${locale}/policies/no-such-policy`,
    happyPath: '#policy-heading',
  },
  {
    name: 'category',
    path: (locale: string) => `/${locale}/catalog/no-such-category`,
    happyPath: 'catalog-category-bar',
  },
  {
    name: 'product',
    path: (locale: string) => `/${locale}/catalog/product/no-such-product`,
    happyPath: '[data-testid="product-detail-page"]',
  },
] as const;

test.describe('loader 404 surfaces the locale not-found page', () => {
  let baseline: ConsoleBaseline;
  let currentPage: Page;
  test.beforeEach(({ page }) => {
    currentPage = page;
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    // Exactly one thing is allowed through: the browser's own log line for
    // this document answering 404, which is the status these tests assert.
    // It is matched on the resource URL, not on the message text, so a 404 on
    // an image or an API call still fails.
    //
    // The uncaught HttpErrorResponse that used to reach StorefrontErrorHandler
    // on every one of these navigations stays unlisted. It is a first-class
    // symptom and allow-listing it would hide the next instance of this class.
    baseline.assertClean({ ignore: [expectedDocumentNotFound(currentPage)] });
  });

  describeEveryLocale('unknown slug', (locale) => {
    for (const route of LOADER_ROUTES) {
      test(`${route.name}: renders the not-found page under a real 404`, async ({ page }) => {
        const response = await page.goto(route.path(locale));

        expect(response, 'no response at all').toBeTruthy();
        expect(response!.status(), 'a 200 here is a soft 404 on an unbounded URL space').toBe(404);

        // The exact string, not toBeVisible(): visibility passes on an empty
        // element, and the heading is the one thing that proves the locale
        // surface rendered rather than the bilingual root /404.
        await expect(page.locator('#not-found-heading')).toHaveText(copyFor(HEADING, locale));

        await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
          'content',
          'noindex, nofollow',
        );

        await expect(page.locator(route.happyPath)).toHaveCount(0);

        // The assertion that actually failed before the fix. Everything above
        // could pass on a page that rendered the right ids and nothing else.
        const mainChildren = await page.locator('main > *').count();
        expect(mainChildren, 'main is empty: the route component never mounted').toBeGreaterThan(0);

        // The requested URL is preserved: skipLocationChange keeps the reader
        // and the crawler on the URL they asked for.
        expect(new URL(page.url()).pathname).toBe(route.path(locale));
      });

      test(`${route.name}: the SSR HTML itself carries the 404`, async ({ request }) => {
        // Raw HTTP, no browser: this is what a crawler that runs no
        // JavaScript receives. Three conjunctive assertions, never a
        // disjunction that a broken build can satisfy from the wrong side.
        const res = await request.get(route.path(locale));
        const html = await res.text();

        expect(res.status()).toBe(404);
        expect(html).toContain('id="not-found-heading"');
        expect(html).toContain(copyFor(HEADING, locale));
        expect(html).not.toContain('id="policy-heading"');

        // A 404 with no cache directive is heuristically cacheable, and every
        // one of these slugs may exist tomorrow.
        expect(res.headers()['cache-control']).toContain('no-store');
      });
    }
  });
});
