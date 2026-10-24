/**
 * Production-build SSR smoke gate.
 *
 * WHY THIS EXISTS. Every Playwright project boots `nx serve storefront`, so no
 * gate in this repo has ever run a production Nitro build. That is exactly the
 * hole commit `0c9801a8` fell through: on a production build Analog's
 * `requestContextInterceptor` resolves a page-server companion over an internal
 * `$fetch` that drops the query string, so `/fr/catalog?brand=X` server-rendered
 * the whole catalogue and `/fr/search?q=lampe` server-rendered the empty-results
 * page. The Vite dev server takes a different branch and keeps the url intact,
 * so the whole suite stayed green while production was broken, for months. See
 * `apps/storefront/src/lib/loader-query.ts` for the mechanism.
 *
 * WHAT IT DOES. Plain HTTP GETs against a running production server. No browser,
 * no JS execution, no hydration: every assertion reads bytes out of the HTML the
 * server sent, which is the only thing a crawler, a link preview or a first paint
 * ever sees. Four claims, each one a page that must answer its url:
 *
 *   1. a filtered catalogue url renders a NARROWED grid, and the slugs in it, in
 *      order, are the slugs the API returns for the same query;
 *   2. a search url with `?q=` renders its hits, not the no-results state;
 *   3. a product page renders `Product` JSON-LD;
 *   4. a category deep link with filter params renders a grid narrowed against
 *      the same category unfiltered.
 *
 * THREE GUARDS AND ONE CONTROL, and the difference is worth stating plainly
 * because miscounting it is how a suite ends up trusting something that cannot
 * fail. Legs 1, 2 and 4 go red when the query stops reaching the server; leg 2
 * is the most decisive of the three, because it needs only a term that matches
 * something rather than a fixture that narrows. Leg 3 is a CONTROL: the product
 * loader reads `params.slug` and no query at all, so no query-transport defect
 * can ever move it. It earns its place by proving the rest of the run means
 * something: that the Nitro bundle booted, the API answered, and the Angular
 * server platform ran and wrote imperatively into the served `<head>`.
 *
 * WHAT IS AND IS NOT A DISCRIMINATOR. The page components read the query a
 * SECOND time, from the Angular route snapshot, before the browser-only guard
 * returns. So on a build with the defect the filter rail still renders the brand
 * ticked, the sort control still shows the deep-linked sort, and the search `h1`
 * and `<title>` still carry the term, over a grid that ignored all of it. Every
 * one of those is green forever and none of them may be asserted here. The only
 * honest discriminators are the ones fed by the loader payload: the ordered
 * `data-product-slug` list, the numeric result count, and which of
 * `catalog-grid` / `catalog-grid-empty` the page drew.
 *
 * A FOURTH DISCRIMINATOR, FOR A DIFFERENT DEFECT CLASS. `searchPrices` compares
 * the price each cell rendered against the `minPrice` the API reported for that
 * slug. It is fed by the loader payload like the three above, but it does not
 * guard query transport: it stays green on a dropped query as long as the wrong
 * hits carry prices. It guards the search serializer's FIELD NAMES, which drifted
 * (`minPrice` on the wire, `priceMin` in the storefront schema) and shipped a
 * literal `0,000 DT` on every card while the slug list, the order and the count
 * all still matched. Read a failure there as field-name drift, not as another
 * `0c9801a8`.
 *
 * NEVER SKIPS. Each leg first reads a discriminating fixture from the live API
 * and hard-fails when the catalogue cannot tell a filtered page from an
 * unfiltered one. A leg that quietly passes on a comparison that proves nothing
 * is how the original defect survived its own test. The same rule covers the
 * page's third rendered state: a catalogue or search that soft-failed to its
 * error panel looks exactly like a dropped query, so it is named as a fixture
 * problem rather than reported as the regression.
 *
 * READ ONLY. `get()` is the only request this file can make. The gate runs
 * against whatever API the operator points it at, including a production one, so
 * it must never be able to write.
 *
 * Env:
 *   STOREFRONT_SMOKE_BASE_URL  server under test  (default http://localhost:53311)
 *   STOREFRONT_API_URL         API base, prefix included
 *                              (default http://localhost:53001/api, the test API)
 *   STOREFRONT_SMOKE_LOCALES   comma-separated  (default: the locales the store serves,
 *                              read from GET /v1/store/config)
 *   STOREFRONT_SMOKE_TIMEOUT   per-request ms   (default 20000)
 *
 * Exit codes: 0 pass · 1 a page rendered wrong · 2 the fixture or the harness
 * could not produce a meaningful comparison. Both non-zero codes fail the gate.
 */

const DEFAULT_BASE_URL = 'http://localhost:53311';
const DEFAULT_API_URL = 'http://localhost:53001/api';
const PAGE_SIZE = 24;

/** The order the loaders resolve for a bare url has no tiebreak (`createdAt desc`,
 * see `lib/catalog-sort.ts`), so every comparison here pins a total one. */
const STABLE_SORT = { sortBy: 'price', sortOrder: 'asc' };

class SmokeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SmokeError';
  }
}

/** The catalogue cannot answer the question this leg asks. Not a pass. */
class FixtureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FixtureError';
  }
}

function check(condition, message) {
  if (!condition) throw new SmokeError(message);
}

function requireFixture(condition, message) {
  if (!condition) throw new FixtureError(message);
}

// ── transport ─────────────────────────────────────────────────────────────
// One helper, method fixed. Nothing in this file can issue a write.

async function get(url, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: controller.signal,
    });
  } catch (err) {
    throw new FixtureError(
      `GET ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fixture discovery walks the catalogue looking for something that discriminates,
 * and the API allows 100 requests per minute per IP (`app.module.ts`). So every
 * lookup that can repeat is memoised, every search loop is capped, and a 429 is
 * named rather than left to surface as an unexplained fixture failure.
 */
const MAX_SEARCH_TERM_PROBES = 8;
const MAX_CATEGORY_PROBES = 20;

function qs(query) {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    usp.append(key, String(value));
  }
  return usp.toString();
}

// ── HTML readers ──────────────────────────────────────────────────────────
// Every one of these reads RENDERED markup. `data-product-slug` is written by
// `sections/catalog/product-grid.component.ts` onto the grid cells and appears
// nowhere else, in particular not in Analog's TransferState payload, which
// serialises the loader response as JSON (`"slug":"..."`, no attribute). A
// reader that matched the payload would report a pass for a page that rendered
// nothing, which is the failure mode this gate is built to catch.

function gridSlugs(html) {
  return [...html.matchAll(/data-product-slug="([^"]+)"/g)].map((m) => m[1]);
}

/** The catalogue / category result-count line, or null when the grid is empty. */
function resultsLine(html) {
  return html.match(/<p[^>]*class="results"[^>]*>([\s\S]*?)<\/p>/)?.[1]?.trim() ?? null;
}

/** The search result-count line, which carries its own test id. */
function searchResultsLine(html) {
  return (
    html.match(/<p[^>]*data-testid="search-results-count"[^>]*>([\s\S]*?)<\/p>/)?.[1]?.trim() ??
    null
  );
}

/**
 * The number a count line states, as a number.
 *
 * Read numerically, never as a substring. Counts nest: `"95 produits"` contains
 * `"9"` and `"5"`, so a substring test would have reported the UNFILTERED page
 * as carrying a filtered total of 9, turning the one backstop that catches a
 * filtered page whose first 24 cells coincide with the bare page into a
 * false green. The copy is `{count} produits` / `{count} products` with a
 * singular branch (`lib/catalog-copy.ts`), so the leading integer is the count
 * in every locale and both grammatical numbers.
 */
function countIn(line) {
  const digits = line?.match(/\d+/)?.[0];
  return digits === undefined ? null : Number(digits);
}

/**
 * The rendered grid, cell by cell: each cell's slug and the prices it drew.
 *
 * Scoped to the `<ul data-testid="catalog-grid">` slice on purpose. Everything
 * outside it is a false-positive farm for a price reader: the TransferState
 * `<script id="ng-state">` at the end of `<body>` carries the loader payload
 * verbatim, so `"minPrice":48` is in the document whether or not a single card
 * rendered it, and the ISO `createdAt` strings in the same blob spell `0.000`
 * on any timestamp with zero milliseconds. No `<ul>` or `<li>` exists inside a
 * card, so the first `</ul>` after the marker closes the grid.
 */
function gridRegion(html) {
  const at = html.indexOf('data-testid="catalog-grid"');
  if (at === -1) return null;
  const open = html.lastIndexOf('<ul', at);
  const end = html.indexOf('</ul>', at);
  if (end === -1) return null;
  return html.slice(open === -1 ? at : open, end + 5);
}

/**
 * Entity-decode a rendered text run.
 *
 * Angular's server renderer escapes U+00A0 to `&nbsp;`, and `formatMoney` puts
 * exactly one between the amount and the symbol. Searching the raw bytes for a
 * string typed with a literal U+00A0 therefore never matches, which is the trap
 * that looks most correct.
 */
function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, String.fromCodePoint(0x00a0))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function textOf(fragment) {
  return decodeEntities(fragment.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '')).trim();
}

/**
 * A rendered price as a number, whatever the locale or the currency.
 *
 * Read numerically for the same reason `countIn` is: as a substring, a
 * legitimate `50,000` contains `0,000`, so a scan for the broken zero would go
 * red on any price whose integer part ends in a zero. Digits only, because
 * `lib/money.ts` groups with U+202F, spaces the symbol with U+00A0, and switches
 * the decimal mark between fr and en. Formatting itself is not this gate's job;
 * `src/lib/money.spec.ts` asserts the exact codepoints.
 */
function parseMoney(text) {
  const run = text.match(/\d[\d\s.,\u202f\u00a0]*/);
  if (!run) return null;
  const cleaned = run[0].replace(/[\s\u202f\u00a0]/g, '').replace(',', '.');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function gridCells(html) {
  const region = gridRegion(html) ?? '';
  const re = /<li[^>]*data-product-slug="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g;
  return [...region.matchAll(re)].map(([, slug, cell]) => ({
    slug,
    prices: [
      ...cell.matchAll(/<span[^>]*class="[^"]*\bamount\b[^"]*"[^>]*>([\s\S]*?)<\/span>/g),
    ].map((m) => parseMoney(textOf(m[1]))),
  }));
}

function jsonLdBlocks(html) {
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // A malformed block is not silently tolerated: the caller asserts on the
      // @type it needs, so an unparseable payload surfaces as that @type missing.
    }
  }
  return out;
}

/** No-results copy per locale, from `src/i18n/{fr,en,ar}.ts` `search.noResults.title`. */
const SEARCH_NO_RESULTS_COPY = {
  fr: 'Aucun résultat',
  en: 'No results found',
  ar: 'لا توجد نتائج',
};

// ── the gate ──────────────────────────────────────────────────────────────

class Smoke {
  constructor(options) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs;
    this.notes = [];
    /** Memo for reads that fixture discovery repeats. Reference reads bypass it. */
    this.cache = new Map();
  }

  note(line) {
    this.notes.push(line);
    process.stdout.write(`      ${line}\n`);
  }

  /** A storefront page, as bytes. */
  async page(path) {
    const url = `${this.baseUrl}${path}`;
    const res = await get(url, { Accept: 'text/html' }, this.timeoutMs);
    // `redirect: 'manual'` on purpose. A locale or trailing-slash redirect drops
    // the query on some servers, and a 200 fetched after a silent hop reads
    // exactly like the defect: a page that rendered without its filter.
    check(
      res.status === 200,
      `GET ${path} answered ${res.status}${res.headers.get('location') ? ` → ${res.headers.get('location')}` : ''}, expected 200 with no redirect`,
    );
    const html = await res.text();

    // Angular's server platform stamps this on the root element of a real SSR
    // pass. Without it the bytes came from a client-rendered shell or an error
    // page, and every assertion below would be reading the wrong document.
    check(
      html.includes('ng-server-context="ssr-analog"'),
      `GET ${path} did not come from an Analog SSR render (no ng-server-context="ssr-analog")`,
    );

    // The third rendered state. Both grids soft-fail to an error panel rather
    // than to an empty page, and an error panel has no slugs and no count: the
    // same shape a dropped query produces. Naming it as a fixture problem is the
    // difference between "the storefront regressed" and "the API blipped" or
    // "the full-text index is gone".
    requireFixture(
      !html.includes('data-testid="catalog-error"'),
      `GET ${path} rendered the catalogue error panel: the products fetch failed, so this page ` +
        'cannot say anything about the query. Check the API is healthy.',
    );
    requireFixture(
      !html.includes('data-testid="search-error"'),
      `GET ${path} rendered the search error panel: /v1/search failed, so this page cannot say ` +
        'anything about the query. The usual cause is a missing full-text index: a bare ' +
        '`prisma db push` drops the searchVector column; repair with `npm run db:fts`.',
    );
    return html;
  }

  /**
   * An API read, locale-resolved.
   *
   * `cache: true` is for fixture discovery, which asks the same questions many
   * times over. The before/after reference reads around a render never cache:
   * reading the same snapshot twice would defeat the point of taking two.
   */
  /**
   * An unknown slug must answer 404, not 200.
   *
   * This is a PRODUCTION-ONLY defect and that is the whole reason it lives in
   * this harness rather than in the e2e suite. Measured 2026-09-02: the dev
   * server answers 404 on every unknown slug, while a production one answers
   * 200 and renders an error shell. A soft 404 is invisible to an uptime check,
   * reads to a crawler as a thin duplicate page rather than a removal, and makes
   * a redirect impossible to observe, because there is no failure to redirect
   * from.
   *
   * Every route with a slug is checked, not just the product one: they share the
   * loader-throws-h3-error mechanism, so a fix that only reaches one of them has
   * not fixed the mechanism.
   */
  async notFound(locale) {
    const paths = [
      `/${locale}/catalog/product/zzz-ssr-smoke-no-such-product`,
      `/${locale}/catalog/zzz-ssr-smoke-no-such-category`,
      `/${locale}/pages/zzz-ssr-smoke-no-such-page`,
      `/${locale}/policies/zzz-ssr-smoke-no-such-policy`,
    ];
    const wrong = [];
    for (const path of paths) {
      const res = await get(`${this.baseUrl}${path}`, {}, this.timeoutMs);
      if (res.status !== 404) wrong.push(`${path} answered ${res.status}`);
    }
    check(
      wrong.length === 0,
      `unknown slugs must answer 404 so a removal is a removal and a redirect is observable. ` +
        `Got: ${wrong.join('; ')}`,
    );
  }

  /**
   * A `SeoRedirect` row must actually redirect on the origin that serves the URL.
   *
   * The rows hold storefront paths, but `SeoRedirectMiddleware` is mounted on the
   * API (`seo.module.ts`), and nginx never routes a storefront path there. So
   * every row was inert while the existing verify check reported green, because
   * that check only asserted the redirect TARGET resolves and never requested a
   * `fromPath`. This asks the question that was missing.
   *
   * Skips as a fixture issue rather than failing when no row exists, so the leg
   * cannot go green merely because the table is empty.
   */
  async redirectResolves(locale) {
    const res = await this.api('/v1/seo/redirects', { pageSize: 50 }, locale).catch(() => null);
    const rows = Array.isArray(res?.data) ? res.data : [];
    const row = rows.find(
      (r) => typeof r?.fromPath === 'string' && r.fromPath.startsWith(`/${locale}/`),
    );
    requireFixture(
      Boolean(row),
      `no SeoRedirect row for /${locale}/ to probe. The leg cannot ask its question.`,
    );

    // `get` already sets redirect: 'manual'; its second argument is headers.
    const res2 = await get(`${this.baseUrl}${row.fromPath}`, {}, this.timeoutMs);
    check(
      res2.status === 301 || res2.status === 308,
      `GET ${row.fromPath} answered ${res2.status}, expected a permanent redirect to ${row.toPath}`,
    );
    check(
      (res2.headers.get('location') ?? '') === row.toPath,
      `GET ${row.fromPath} redirected to "${res2.headers.get('location')}", expected "${row.toPath}"`,
    );
  }

  async api(path, query, locale, { cache = false } = {}) {
    const search = query ? `?${qs(query)}` : '';
    const url = `${this.apiUrl}${path}${search}`;
    const key = `${locale}|${url}`;
    if (cache && this.cache.has(key)) return this.cache.get(key);

    const res = await get(url, { 'Accept-Language': locale }, this.timeoutMs);
    requireFixture(
      res.status !== 429,
      `GET ${path}${search} answered 429. The API allows 100 requests per minute per IP and this ` +
        'gate spent them on fixture discovery. Run one locale (STOREFRONT_SMOKE_LOCALES=<one locale>) or ' +
        'pin the fixtures with STOREFRONT_SMOKE_SEARCH_TERM.',
    );
    requireFixture(res.status === 200, `GET ${path}${search} answered ${res.status}`);
    const body = await res.json();
    if (cache) this.cache.set(key, body);
    return body;
  }

  /**
   * The slugs and the count the API returns for a product query.
   *
   * `Accept-Language` is not decoration: names are Translatable and `sortBy=name`
   * collates the resolved name, so the reference page for `fr` and for `en` are
   * genuinely different orders.
   */
  async apiProducts(query, locale, options) {
    const body = await this.api(
      '/v1/products',
      { page: 1, pageSize: PAGE_SIZE, ...query },
      locale,
      options,
    );
    return {
      slugs: (body.data ?? []).map((p) => p.slug),
      total: body.meta?.total ?? (body.data ?? []).length,
    };
  }

  /**
   * Compare a rendered grid against the API answer for the same query.
   *
   * The reference is read on both sides of the render. Anything writing to the
   * catalogue between two reads must not fail an assertion that is about whether
   * the query reached the server; a render that ignored the query matches
   * neither snapshot, which is the case this exists to catch.
   */
  async expectGridMatchesApi({ path, query, locale, bare, label }) {
    const before = await this.apiProducts(query, locale);
    const html = await this.page(path);
    const after = await this.apiProducts(query, locale);

    check(
      html.includes('data-testid="catalog-grid"'),
      `${label}: ${path} rendered no product grid` +
        (html.includes('data-testid="catalog-grid-empty"') ? ' (it rendered the empty state)' : ''),
    );

    const rendered = gridSlugs(html);
    check(
      [before, after].some((page) => page.slugs.join(',') === rendered.join(',')),
      `${label}: the server-rendered grid is not the page the API returns for that query
        rendered:     ${rendered.join(', ') || '(nothing)'}
        API (before): ${before.slugs.join(', ')}
        API (after):  ${after.slugs.join(', ')}`,
    );
    check(
      rendered.join(',') !== bare.slugs.join(','),
      `${label}: ${path} server-rendered the UNFILTERED page. The query never reached the loader
        rendered: ${rendered.join(', ')}`,
    );

    const line = resultsLine(html);
    const count = countIn(line);
    check(
      [before.total, after.total].includes(count),
      `${label}: the rendered result count is ${count} ("${line}"), neither ${before.total} nor ${after.total}`,
    );
    // The count is the backstop for the case where the filtered page-1 and the
    // bare page-1 hold the same 24 cells. It only backstops anything if it is
    // read as a number: `"95 produits".includes("9")` is true.
    check(
      count !== bare.total || before.total === bare.total,
      `${label}: the rendered result count is ${bare.total}, the UNFILTERED total. The query ` +
        'never reached the loader',
    );

    this.note(`${rendered.length} of ${bare.slugs.length} cells rendered, count line "${line}"`);
    return rendered;
  }

  /**
   * Does this filter produce a page that is visibly not the unfiltered page?
   *
   * A smaller total is NOT enough, and assuming it was would have made this gate
   * both false-green and false-red. The loader ships page 1 only, capped at 24,
   * so a set of 29 narrowed to 26 can render an identical first 24; and because
   * the pinned sort is price-ascending, a `maxPrice` filter yields a strict
   * PREFIX of the unfiltered order, which is the same 24 cells again whenever
   * the filtered set is large enough. In the first shape the gate would pass on
   * a broken build; in the second it would fail a correct one. So a filter is
   * only accepted once the API says the rendered page itself differs.
   */
  discriminates(expected, unfiltered) {
    return (
      expected.total > 0 &&
      expected.total < unfiltered.total &&
      expected.slugs.join(',') !== unfiltered.slugs.join(',')
    );
  }

  /**
   * A filter that provably narrows the given product set, searched for rather
   * than assumed, or `null` when this set cannot be narrowed at all.
   *
   * Brand first because it is one exact value the rail actually offers; price
   * bands are the fallback for a catalogue that carries a single brand. The
   * caller decides whether a `null` is fatal: for the whole catalogue it is,
   * for one category among many it just means trying the next one.
   */
  async narrowingFilter(scope, locale, unfiltered) {
    const brands =
      (
        await this.api(
          '/v1/products/brands',
          scope.categoryId ? { categoryId: scope.categoryId } : undefined,
          locale,
          { cache: true },
        )
      ).data ?? [];
    for (const { brand, count } of brands) {
      if (count <= 0 || count >= unfiltered.total) continue;
      const expected = await this.apiProducts({ ...STABLE_SORT, ...scope, brand }, locale, {
        cache: true,
      });
      if (this.discriminates(expected, unfiltered)) return { brand };
    }
    // The bands the rail actually offers, from `sections/catalog/filter-rail.component.ts`.
    const bands = [
      { maxPrice: 49.999 },
      { minPrice: 50, maxPrice: 249.999 },
      { minPrice: 250, maxPrice: 999.999 },
      { minPrice: 1000 },
    ];
    for (const band of bands) {
      const expected = await this.apiProducts({ ...STABLE_SORT, ...scope, ...band }, locale, {
        cache: true,
      });
      if (this.discriminates(expected, unfiltered)) return band;
    }
    return await this.derivedPriceBand(scope, locale, unfiltered);
  }

  /**
   * A price ceiling cut from the prices this set actually carries.
   *
   * The rail's four bands are fixed and were drawn for a different price range,
   * so a whole catalogue can sit inside one of them and none of the four
   * narrows anything, which is a fact about the seed, not about the storefront,
   * and must not be allowed to read as "the gate cannot run". `maxPrice` is
   * forwarded by the same line of the loader as any other filter, so a cut
   * taken from the data proves exactly what a rail band would.
   */
  async derivedPriceBand(scope, locale, unfiltered) {
    const body = await this.api(
      '/v1/products',
      { page: 1, pageSize: PAGE_SIZE, ...STABLE_SORT, ...scope },
      locale,
      { cache: true },
    );
    const prices = [
      ...new Set(
        (body.data ?? [])
          // `minPrice` is the rolled-up name the API sends. `/v1/products` always
          // carries `variants`, so the fallback is belt-and-braces here, but it
          // read `priceMin` (a name no serializer has ever emitted) and this file
          // is plain `.cjs`, so no compiler or lint rule would ever have said so.
          .map((p) => Number(p.variants?.[0]?.price ?? p.minPrice))
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    ].sort((a, b) => a - b);
    if (prices.length < 2) return null;

    // Every cut but the last leaves something out; the middle one is the most
    // discriminating, the cheapest is the smallest resulting page.
    const cuts = [prices[Math.floor(prices.length / 2) - 1], prices[0]].filter(
      (p, i, all) => p !== undefined && all.indexOf(p) === i,
    );
    for (const maxPrice of cuts) {
      const band = { maxPrice };
      const expected = await this.apiProducts({ ...STABLE_SORT, ...scope, ...band }, locale, {
        cache: true,
      });
      if (this.discriminates(expected, unfiltered)) return band;
    }
    return null;
  }

  // ── leg 1: a filtered catalogue url renders a narrowed grid ──────────────
  async filteredCatalog(locale) {
    const bare = await this.apiProducts(STABLE_SORT, locale);
    requireFixture(
      bare.total > 1,
      `the catalogue holds ${bare.total} product(s); nothing to narrow`,
    );
    const filter = await this.narrowingFilter({}, locale, bare);
    requireFixture(
      filter,
      `no brand and no price band narrows this catalogue of ${bare.total} product(s): nothing ` +
        'here can tell a filtered render from an unfiltered one, so this leg would pass on a ' +
        'comparison that proves nothing.',
    );
    this.note(`filter ${JSON.stringify(filter)} against ${bare.total} products`);

    const query = { ...STABLE_SORT, ...filter };
    await this.expectGridMatchesApi({
      path: `/${locale}/catalog?${qs(query)}`,
      query,
      locale,
      bare,
      label: 'filtered catalogue',
    });
  }

  // ── leg 2: a search url with ?q= renders its hits ────────────────────────
  async searchHits(locale) {
    const term = await this.searchTerm(locale);
    const body = await this.api('/v1/search', { q: term, page: 1, pageSize: PAGE_SIZE }, locale);
    const expected = (body.data ?? []).map((hit) => hit.product?.slug).filter(Boolean);
    const total = body.meta?.total ?? expected.length;
    requireFixture(
      expected.length > 0,
      `"${term}" matches nothing, so a rendered no-results page would be correct and this leg ` +
        'could not tell a working search from a broken one',
    );
    this.note(`"${term}" → ${total} hit(s)`);

    const path = `/${locale}/search?${qs({ q: term })}`;
    const html = await this.page(path);

    // The defect rendered exactly this: no `q` reached the loader, so the loader
    // short-circuited to the empty payload and the page drew its no-results CTA.
    check(
      !html.includes('data-testid="catalog-grid-empty"'),
      `search: ${path} server-rendered the no-results state for a term with ${total} hit(s). ` +
        'the query never reached the loader',
    );
    requireFixture(
      SEARCH_NO_RESULTS_COPY[locale] !== undefined,
      `no no-results copy for '${locale}' in SEARCH_NO_RESULTS_COPY`,
    );
    check(
      !html.includes(SEARCH_NO_RESULTS_COPY[locale]),
      `search: ${path} server-rendered "${SEARCH_NO_RESULTS_COPY[locale]}" for a term with ${total} hit(s)`,
    );
    check(html.includes('data-testid="catalog-grid"'), `search: ${path} rendered no results grid`);

    const rendered = gridSlugs(html);
    check(
      rendered.length > 0 && rendered.join(',') === expected.join(','),
      `search: the server-rendered hits are not what the API returns for "${term}"
        rendered: ${rendered.join(', ') || '(nothing)'}
        API:      ${expected.join(', ')}`,
    );
    const line = searchResultsLine(html);
    check(
      countIn(line) === total,
      `search: the rendered result count is ${countIn(line)} ("${line}"), not the ${total} hit(s) the API found`,
    );
    // Deliberately NOT asserted here: that the term appears somewhere in the
    // page. The component re-reads `?q=` from the Angular route snapshot and
    // renders it into the heading and the <title> whether or not the loader ever
    // saw it, so that check is green on a build with the defect. It would read
    // like proof and be worth nothing.
    this.note(`${rendered.length} hit(s) rendered, count line "${line}"`);

    this.searchPrices(body, html, term);
  }

  /**
   * Every card draws the price `/v1/search` reported for it.
   *
   * A different defect class from the rest of this leg, and the failure message
   * has to say so: this one guards the search serializer's FIELD NAMES, not query
   * transport. It stays green on a dropped query as long as the wrong hits carry
   * prices, and the slug list above stays green when the names drift. A reader
   * who sees this fail while the slug list still matches is looking at field-name
   * drift, not at another `0c9801a8`.
   *
   * It exists because that drift shipped: the serializer sends `minPrice`, the
   * search page read `variants[0].price` and then a `priceMin` nothing has ever
   * emitted, and floored the card at a literal `0`. Every card on
   * `/fr/search?q=lampe` rendered `0,000 DT` in production, with the right slugs
   * in the right order and the right count, so all three existing assertions
   * passed on it.
   *
   * Reuses the `html` the caller already fetched. No extra page load, no extra
   * API call.
   */
  searchPrices(body, html, term) {
    const apiPrice = new Map(
      (body.data ?? [])
        .map((hit) => [hit.product?.slug, Number(hit.product?.minPrice)])
        .filter(([slug, price]) => slug && Number.isFinite(price)),
    );
    // `>= 1` so the comparison below cannot be satisfied by the zero the defect
    // draws, and so a catalogue of genuinely free items reports as a fixture
    // problem rather than as a pass.
    const priced = [...apiPrice].filter(([, price]) => price >= 1);
    requireFixture(
      priced.length > 0,
      `every hit for "${term}" carries a null or sub-unit minPrice, so a card drawing 0 would be ` +
        'correct and this leg could not tell the price defect from the data',
    );

    const cells = gridCells(html);
    const bySlug = new Map(cells.map((cell) => [cell.slug, cell]));

    for (const [slug, minPrice] of priced) {
      const cell = bySlug.get(slug);
      check(cell !== undefined, `search: no rendered cell for ${slug}, which the API returned`);
      if (!cell) continue;
      // check(), never requireFixture(): after the fix a price-less product
      // renders no price line at all, so a fixture bail here would let a real
      // regression exit 2 and read as "the harness could not tell".
      check(
        cell.prices.length > 0,
        `search: the card for ${slug} rendered no price line, but /v1/search reports ` +
          `minPrice ${minPrice}. The search serializer sends \`minPrice\`; a reader looking for ` +
          '`priceMin` or `variants[0].price` finds neither.',
      );
      check(
        cell.prices.some((price) => price !== null && Math.abs(price - minPrice) < 0.5),
        `search: the card for ${slug} rendered ${JSON.stringify(cell.prices)}, not the ` +
          `${minPrice} /v1/search returned`,
      );
    }

    // The other half of the rule: a card may never substitute a zero for a price
    // it could not resolve. Compared against the API rather than scanned for as a
    // string, so a legitimate 50 (which renders `50,000 DT`) cannot trip it and a
    // genuinely free product cannot either.
    for (const cell of cells) {
      for (const price of cell.prices) {
        check(
          price !== 0 || apiPrice.get(cell.slug) === 0,
          `search: the card for ${cell.slug} rendered a price of zero while /v1/search reports ` +
            `minPrice ${apiPrice.get(cell.slug)}. A hit with no resolvable price must render no ` +
            'price line at all, never a literal 0.',
        );
      }
    }

    this.note(
      `prices: ${priced
        .map(
          ([slug, price]) =>
            `${slug} api=${price} rendered=${bySlug.get(slug)?.prices.join('/') ?? '(none)'}`,
        )
        .join(', ')}`,
    );
  }

  /**
   * A term that provably matches something, taken from a real product name so
   * the leg survives any reseed. The longest alphabetic word wins: short words
   * collide with stop words and the API's full-text config drops them.
   */
  async searchTerm(locale) {
    const override = process.env['STOREFRONT_SMOKE_SEARCH_TERM'];
    if (override) return override;
    const { data } = await this.api('/v1/products', { page: 1, pageSize: 10 }, locale, {
      cache: true,
    });

    const candidates = [];
    for (const product of data ?? []) {
      const name = typeof product.name === 'string' ? product.name : '';
      for (const word of name
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 4)
        .sort((a, b) => b.length - a.length)) {
        if (!candidates.includes(word)) candidates.push(word);
      }
    }
    for (const word of candidates.slice(0, MAX_SEARCH_TERM_PROBES)) {
      const body = await this.api('/v1/search', { q: word, page: 1, pageSize: 1 }, locale, {
        cache: true,
      });
      if ((body.meta?.total ?? 0) > 0) return word;
    }
    throw new FixtureError(
      `none of the first ${Math.min(candidates.length, MAX_SEARCH_TERM_PROBES)} words taken from ` +
        'product names matches anything through /v1/search. Either the catalogue is empty or the ' +
        'full-text index is missing (`npm run db:fts`; a bare `prisma db push` drops the ' +
        'searchVector column). Pin a known term with STOREFRONT_SMOKE_SEARCH_TERM.',
    );
  }

  // ── leg 3: a product page carries Product JSON-LD ────────────────────────
  async productJsonLd(locale) {
    const { data } = await this.api(
      '/v1/products',
      { page: 1, pageSize: 1, ...STABLE_SORT },
      locale,
      { cache: true },
    );
    const product = (data ?? [])[0];
    requireFixture(product?.slug, 'the catalogue holds no product to render');

    const path = `/${locale}/catalog/product/${encodeURIComponent(product.slug)}`;
    const html = await this.page(path);
    check(
      html.includes('data-testid="product-detail-page"'),
      `product: ${path} did not render the product detail page`,
    );

    const blocks = jsonLdBlocks(html);
    const productLd = blocks.find((b) => b && b['@type'] === 'Product');
    check(
      productLd,
      `product: ${path} carries no parseable Product JSON-LD in the served HTML ` +
        `(found @type: ${blocks.map((b) => b?.['@type']).join(', ') || 'none'}). It is injected by ` +
        'the page component, so its absence means the Angular server platform did not render.',
    );
    check(
      typeof productLd.name === 'string' && productLd.name.length > 0,
      `product: the Product JSON-LD carries no name (${JSON.stringify(productLd).slice(0, 200)})`,
    );
    check(
      productLd.offers != null,
      `product: the Product JSON-LD carries no offers block, so no price is exposed`,
    );
    this.note(`${product.slug} → JSON-LD @type ${blocks.map((b) => b?.['@type']).join(' + ')}`);
  }

  // ── leg 4: a category deep link with params renders a narrowed grid ──────
  async categoryDeepLink(locale) {
    const { category, bare, filter } = await this.narrowableCategory(locale);
    const scope = { categoryId: category.id };
    this.note(
      `category ${category.slug} (${bare.total} products), filter ${JSON.stringify(filter)}`,
    );

    const query = { ...STABLE_SORT, ...filter };
    await this.expectGridMatchesApi({
      path: `/${locale}/catalog/${encodeURIComponent(category.slug)}?${qs(query)}`,
      query: { ...query, ...scope },
      locale,
      bare,
      label: 'category deep link',
    });
  }

  /**
   * A category that holds products AND can be narrowed by a filter.
   *
   * Both halves matter, and the first candidate rarely satisfies both: a small
   * category can easily carry one brand and one price band, in which case a
   * filtered render and an unfiltered one are the same page and the leg would
   * prove nothing. So the walk keeps going until a category answers both
   * questions, and only gives up when every candidate has been asked.
   *
   * `categoryId` does not expand a subtree, so a parent whose products all sit
   * on its children answers zero here. Walking the tree flat and asking the API
   * per node is the only reliable way to find one that works.
   */
  async narrowableCategory(locale) {
    const { data } = await this.api('/v1/categories', undefined, locale, { cache: true });
    const flat = [];
    const walk = (nodes) => {
      for (const node of nodes ?? []) {
        flat.push(node);
        walk(node.children);
      }
    };
    walk(data);
    requireFixture(flat.length > 0, 'the API returns no categories');

    const tried = [];
    for (const category of flat.slice(0, MAX_CATEGORY_PROBES)) {
      const bare = await this.apiProducts({ ...STABLE_SORT, categoryId: category.id }, locale, {
        cache: true,
      });
      if (bare.total <= 1) {
        tried.push(`${category.slug}: ${bare.total} product(s)`);
        continue;
      }
      const filter = await this.narrowingFilter({ categoryId: category.id }, locale, bare);
      if (filter) return { category, bare, filter };
      tried.push(`${category.slug}: ${bare.total} product(s), nothing narrows them`);
    }
    throw new FixtureError(
      `no category among ${tried.length} can be narrowed, so a category deep link would render ` +
        `the same page filtered or not and this leg would prove nothing.\n        ${tried.join('\n        ')}`,
    );
  }
}

// ── runner ────────────────────────────────────────────────────────────────

const LEGS = [
  ['filtered catalogue', 'guard', (smoke, locale) => smoke.filteredCatalog(locale)],
  ['search with ?q=', 'guard', (smoke, locale) => smoke.searchHits(locale)],
  // Control, not guard. See the "THREE GUARDS AND ONE CONTROL" note in the file
  // header: the product loader takes no query, so no query-transport defect can
  // move this leg. It proves the run itself is meaningful.
  ['product JSON-LD', 'control', (smoke, locale) => smoke.productJsonLd(locale)],
  ['category deep link', 'guard', (smoke, locale) => smoke.categoryDeepLink(locale)],
  ['unknown slug is 404', 'guard', (smoke, locale) => smoke.notFound(locale)],
  ['SeoRedirect actually redirects', 'guard', (smoke, locale) => smoke.redirectResolves(locale)],
];

/** Comma list to codes. An empty result means "ask the store". */
function parseLocales(value) {
  return (value ?? '')
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);
}

async function servedLocales(apiUrl, timeoutMs) {
  const res = await get(`${apiUrl.replace(/\/+$/, '')}/v1/store/config`, {}, timeoutMs);
  requireFixture(res.status === 200, `GET /v1/store/config answered ${res.status}`);
  const body = await res.json();
  const locales = body?.data?.localization?.supportedLocales;
  requireFixture(
    Array.isArray(locales) && locales.length > 0,
    'GET /v1/store/config returned no supported locales',
  );
  return locales;
}

async function verifySsrSmoke(options) {
  const smoke = new Smoke(options);
  const failures = [];
  let fixtureBroken = false;

  process.stdout.write(
    `[ssr-smoke] server ${smoke.baseUrl} · API ${smoke.apiUrl} · locales ${options.locales.join(', ')}\n`,
  );

  // Fail closed on an API that is not answering, before any leg reads a fixture
  // from it. Without this, an unreachable or wrongly-prefixed API base 500s the
  // catalogue, soft-fails the category grid and the search, and all four legs go
  // red at once for a reason that has nothing to do with the build. `/v1/health`
  // is deliberately not used: it sits outside the global prefix, so it answers
  // 200 even when the prefix in the base url is wrong, which is the exact
  // mistake this is here to name.
  try {
    const res = await get(`${smoke.apiUrl}/v1/health/identity`, {}, options.timeoutMs);
    requireFixture(
      res.status === 200,
      `the API at ${smoke.apiUrl} answered ${res.status} on /v1/health/identity. Check the base ` +
        'url carries the global prefix (`.../api`) and that the API is up.',
    );
  } catch (err) {
    return {
      ok: false,
      fixtureBroken: true,
      failures: [{ label: 'API precondition', kind: 'FIXTURE', message: err.message }],
    };
  }

  let locales = options.locales;
  if (locales.length === 0) {
    try {
      locales = await servedLocales(smoke.apiUrl, options.timeoutMs);
    } catch (err) {
      return {
        ok: false,
        fixtureBroken: true,
        failures: [{ label: 'store locales', kind: 'FIXTURE', message: err.message }],
      };
    }
  }

  for (const locale of locales) {
    for (const [name, kind, run] of LEGS) {
      const label = `${name} (${locale})${kind === 'control' ? ' [control]' : ''}`;
      process.stdout.write(`  · ${label}\n`);
      try {
        await run(smoke, locale);
        process.stdout.write(`    PASS ${label}\n`);
      } catch (err) {
        if (err instanceof FixtureError) fixtureBroken = true;
        failures.push({
          label,
          kind: err instanceof FixtureError ? 'FIXTURE' : 'FAIL',
          message: err.message,
        });
        process.stdout.write(
          `    ${err instanceof FixtureError ? 'FIXTURE' : 'FAIL'} ${label}\n      ${err.message}\n`,
        );
      }
    }
  }

  return { ok: failures.length === 0, failures, fixtureBroken, locales };
}

async function main() {
  const options = {
    baseUrl: process.env['STOREFRONT_SMOKE_BASE_URL'] ?? DEFAULT_BASE_URL,
    apiUrl: process.env['STOREFRONT_API_URL'] ?? DEFAULT_API_URL,
    locales: parseLocales(process.env['STOREFRONT_SMOKE_LOCALES']),
    timeoutMs: Number(process.env['STOREFRONT_SMOKE_TIMEOUT'] ?? 20_000),
  };

  const result = await verifySsrSmoke(options);
  if (result.ok) {
    process.stdout.write(`\n[ssr-smoke] PASS: ${LEGS.length * result.locales.length} legs\n`);
    process.exit(0);
  }

  process.stderr.write('\n[ssr-smoke] FAILED\n');
  for (const failure of result.failures) {
    process.stderr.write(`  ${failure.kind} ${failure.label}\n    ${failure.message}\n`);
  }
  // A fixture that cannot discriminate is not a pass and not a page defect: it
  // means the gate could not ask its question. Distinct code, still non-zero.
  process.exit(result.fixtureBroken && !result.failures.some((f) => f.kind === 'FAIL') ? 2 : 1);
}

module.exports = {
  verifySsrSmoke,
  gridSlugs,
  resultsLine,
  searchResultsLine,
  jsonLdBlocks,
  gridRegion,
  gridCells,
  parseMoney,
};

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(2);
  });
}
