import { expect, test, type APIRequestContext } from '@playwright/test';

import {
  attachConsoleBaseline,
  describeEveryLocale,
  STOREFRONT_API_BASE,
  type ConsoleBaseline,
} from './support';

/**
 * The catalogue's SSR HTML must answer the query the customer deep-linked.
 *
 * WHAT THIS REPLACES. The brand facet already had a guard
 * (`catalog-facets.journey.spec.ts`), and it asserted `waitForURL(/[?&]brand=/)`
 * plus the contents of the filter rail. Both are true whether or not the filter
 * reached the server: the url is written by the browser, and the rail is drawn
 * from `/v1/products/brands` over the whole catalogue. Neither reads the grid.
 * So a defect that server-rendered the ENTIRE catalogue for
 * `/fr/catalog?brand=X` was green for months and shipped to production.
 *
 * Every assertion here is therefore on rendered output, from a direct
 * `request.get` with no browser engine and no JS: the slugs in the SSR grid, in
 * order, must equal the slugs the API returns for that same query, and must
 * differ from the unfiltered page. Any leg whose fixture cannot tell the two
 * apart fails loudly rather than passing on a comparison that proves nothing.
 *
 * The last test pins the transport rather than the page. A production Nitro
 * build strips the query before the page-server companion ever sees it and
 * hands it over on `x-analog-loader-query` instead (see
 * `apps/storefront/src/lib/loader-query.ts`). The dev server this suite runs
 * against keeps the url intact, so nothing else in the suite exercises that
 * path, and the defect lived exactly there.
 */

const PAGE_SIZE = 24;
const LOADER_QUERY_HEADER = 'x-analog-loader-query';

/** Deterministic order: the API tiebreaks price and name on id, createdAt on nothing. */
const STABLE_SORT = { sortBy: 'price', sortOrder: 'asc' } as const;

interface ApiPage {
  slugs: string[];
  total: number;
}

async function apiProducts(
  request: APIRequestContext,
  query: Record<string, string | number>,
  locale: string,
): Promise<ApiPage> {
  const params = new URLSearchParams({
    page: '1',
    pageSize: String(PAGE_SIZE),
    ...Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])),
  });
  // `Accept-Language` is not optional here. Product names are Translatable, and
  // `sortBy=name` collates the RESOLVED name, so the reference page for `fr`
  // and for `en` are genuinely different orders. A reference read without it
  // compares the render against someone else's language.
  const res = await request.get(`${STOREFRONT_API_BASE}/v1/products?${params.toString()}`, {
    headers: { 'Accept-Language': locale },
  });
  expect(res.ok(), `GET /v1/products?${params.toString()} answered ${res.status()}`).toBe(true);
  const body = (await res.json()) as { data: { slug: string }[]; meta?: { total?: number } };
  return { slugs: body.data.map((p) => p.slug), total: body.meta?.total ?? body.data.length };
}

/** The product slugs the server actually rendered into the grid, in DOM order. */
function ssrSlugs(html: string): string[] {
  return [...html.matchAll(/data-product-slug="([^"]+)"/g)].map((m) => m[1] as string);
}

/** The server-rendered result count, or null when the grid rendered empty. */
function ssrResultsLine(html: string): string | null {
  return html.match(/<p[^>]*class="results"[^>]*>([\s\S]*?)<\/p>/)?.[1]?.trim() ?? null;
}

async function ssrCatalog(request: APIRequestContext, path: string): Promise<string> {
  const res = await request.get(path);
  expect(res.status(), `GET ${path}`).toBe(200);
  const html = await res.text();
  // A path typo that lands on the root redirect returns a perfectly good 200
  // with no query, which reads exactly like the defect this guards.
  expect(html, `${path} did not render the catalogue grid`).toContain('data-testid="catalog-grid"');
  return html;
}

function qs(query: Record<string, string | number>): string {
  return new URLSearchParams(
    Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])),
  ).toString();
}

/**
 * Compare the SSR grid with what the API answers for the same query.
 *
 * The reference is read on BOTH sides of the render and either snapshot may
 * match, because the suite runs three workers and the other specs seed and
 * delete products through the admin API while this one reads. A product that
 * appears between two reads must not fail an assertion that is about whether
 * the query reached the server. A render that ignored the query matches
 * neither snapshot, which is the case this exists to catch.
 */
async function expectSsrMatchesApi(
  request: APIRequestContext,
  ssrPath: string,
  apiQuery: Record<string, string | number>,
  locale: string,
  message: string,
): Promise<{ rendered: string[]; totals: number[] }> {
  const before = await apiProducts(request, apiQuery, locale);
  const html = await ssrCatalog(request, ssrPath);
  const after = await apiProducts(request, apiQuery, locale);
  const rendered = ssrSlugs(html);

  const matched = [before, after].some((page) => page.slugs.join(',') === rendered.join(','));
  expect(
    matched,
    `${message}
  SSR:          ${rendered.join(', ')}
  API (before): ${before.slugs.join(', ')}
  API (after):  ${after.slugs.join(', ')}`,
  ).toBe(true);

  const totals = [before.total, after.total];
  const line = ssrResultsLine(html);
  expect(
    totals.some((total) => line?.includes(String(total))),
    `the server-rendered result count ("${line}") is neither ${totals.join(' nor ')}`,
  ).toBe(true);

  return { rendered, totals };
}

describeEveryLocale('catalogue SSR honours the deep-linked query', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`a brand deep link server-renders only that brand (${locale})`, async ({ request }) => {
    const brandsRes = await request.get(`${STOREFRONT_API_BASE}/v1/products/brands`);
    expect(brandsRes.ok(), `GET /v1/products/brands answered ${brandsRes.status()}`).toBe(true);
    const brands = ((await brandsRes.json()) as { data: { brand: string; count: number }[] }).data;

    const unfiltered = await apiProducts(request, STABLE_SORT, locale);
    // A brand that covers the whole catalogue, or none of it, cannot tell a
    // filtered render from an unfiltered one. Fail on the fixture, never skip:
    // a skipped leg reads as covered and is how this defect survived.
    const brand = brands.find((b) => b.count > 0 && b.count < unfiltered.total);
    expect(
      brand,
      `no seeded brand narrows the catalogue (brands: ${JSON.stringify(brands)}, total: ${unfiltered.total})`,
    ).toBeTruthy();

    const expected = await apiProducts(request, { ...STABLE_SORT, brand: brand!.brand }, locale);
    expect(expected.slugs.length, 'the chosen brand matched nothing').toBeGreaterThan(0);
    expect(expected.slugs).not.toEqual(unfiltered.slugs);

    const { rendered } = await expectSsrMatchesApi(
      request,
      `/${locale}/catalog?${qs({ ...STABLE_SORT, brand: brand!.brand })}`,
      { ...STABLE_SORT, brand: brand!.brand },
      locale,
      'the SSR grid is not the brand-filtered page',
    );
    expect(rendered, 'the brand deep link server-rendered the whole catalogue').not.toEqual(
      unfiltered.slugs,
    );
  });

  test(`a sort deep link server-renders that order (${locale})`, async ({ request }) => {
    const byPrice = await apiProducts(request, STABLE_SORT, locale);
    const byName = await apiProducts(request, { sortBy: 'name', sortOrder: 'asc' }, locale);

    // Both orders are tiebroken on id by the API, so this comparison is stable.
    // If the catalogue ever sorts identically by price and by name, the leg
    // proves nothing and must be told so. This is also the leg that makes the
    // locale matrix earn its runtime: name collation resolves the Translatable
    // name, so `fr` and `en` produce different pages for the same url.
    expect(
      byName.slugs,
      'price-asc and name-asc produce the same page: the sort leg cannot discriminate',
    ).not.toEqual(byPrice.slugs);

    const { rendered } = await expectSsrMatchesApi(
      request,
      `/${locale}/catalog?${qs({ sortBy: 'name', sortOrder: 'asc' })}`,
      { sortBy: 'name', sortOrder: 'asc' },
      locale,
      'the SSR grid is not in the deep-linked order',
    );
    expect(rendered, 'the sort deep link server-rendered the default order').not.toEqual(
      byPrice.slugs,
    );
  });

  /**
   * The first band that actually narrows this catalogue, read from the live API.
   * Hard-fails rather than skipping: a band that matches everything or nothing
   * makes the leg that uses it prove nothing, and a skipped leg reads as covered.
   */
  async function narrowingBand(
    request: APIRequestContext,
    unfiltered: ApiPage,
  ): Promise<{ band: Record<string, number>; expected: ApiPage }> {
    // Bands mirror `PRICE_BANDS` in `sections/catalog/filter-rail.component.ts`.
    const bands: Record<string, number>[] = [
      { maxPrice: 49.999 },
      { minPrice: 50, maxPrice: 249.999 },
      { minPrice: 250, maxPrice: 999.999 },
      { minPrice: 1000 },
    ];
    for (const band of bands) {
      const expected = await apiProducts(request, { ...STABLE_SORT, ...band }, locale);
      if (expected.total > 0 && expected.total < unfiltered.total) return { band, expected };
    }
    throw new Error(
      `no price band narrows the seeded catalogue of ${unfiltered.total}: nothing here can tell ` +
        'a filtered render from an unfiltered one.',
    );
  }

  test(`a price band deep link server-renders only that band (${locale})`, async ({ request }) => {
    const unfiltered = await apiProducts(request, STABLE_SORT, locale);
    const { band } = await narrowingBand(request, unfiltered);

    const priceQuery = { ...STABLE_SORT, ...band } as Record<string, string | number>;
    const { rendered } = await expectSsrMatchesApi(
      request,
      `/${locale}/catalog?${qs(priceQuery)}`,
      priceQuery,
      locale,
      'the SSR grid is not the price-filtered page',
    );
    expect(rendered, 'the price deep link server-rendered the whole catalogue').not.toEqual(
      unfiltered.slugs,
    );
  });

  test(`the page endpoint answers a header-only query (${locale})`, async ({ request }) => {
    const unfiltered = await apiProducts(request, STABLE_SORT, locale);
    // The band is searched for, not hard-coded. This is the one leg that
    // exercises the production transport, so it must not be the one that dies on
    // a catalogue whose prices sit outside a guessed range.
    const { band, expected } = await narrowingBand(request, unfiltered);
    const search = qs({ ...STABLE_SORT, ...band });

    // The shape a production Nitro build produces: bare url, query on the
    // header. Nothing else in this suite can reach it, because the dev server
    // the suite runs against never strips the url.
    const res = await request.get(`/api/_analog/pages/${locale}/catalog/index`, {
      headers: { [LOADER_QUERY_HEADER]: search },
    });
    expect(res.status(), 'the catalog page endpoint moved or is unreachable').toBe(200);
    const payload = (await res.json()) as { products: { slug: string }[]; totalCount: number };
    const after = await apiProducts(request, { ...STABLE_SORT, ...band }, locale);

    const rendered = payload.products.map((p) => p.slug).join(',');
    expect(
      [expected, after].some((page) => page.slugs.join(',') === rendered),
      `the page endpoint ignored the header query
  endpoint: ${rendered}
  API:      ${after.slugs.join(', ')}`,
    ).toBe(true);
    expect(payload.totalCount).toBeLessThan(unfiltered.total);
  });
});
