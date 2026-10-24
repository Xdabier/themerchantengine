import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { load as catalogIndexLoad } from './catalog/index.server';
import { load as categoryLoad } from './catalog/[slug].server';
import { load as searchLoad } from './search/index.server';

/**
 * SSR query-param drop regression guard, per-loader coverage.
 *
 * THE BUG THIS PINS. A production Nitro build never gives a page-server
 * companion its query string. Analog's `requestContextInterceptor`
 * (`@analogjs/router` 2.4.10) resolves a loader over the internal Nitro
 * `$fetch` whenever `global.$fetch` exists, and that branch calls
 *
 *     global.$fetch.raw(requestUrl.pathname, { params: requestUrl.searchParams })
 *
 * `pathname` has already dropped the search, and `params` cannot restore it:
 * ofetch merges the option with an object spread, and spreading a
 * `URLSearchParams` yields `{}`. So `/fr/catalog?brand=X` reaches the endpoint
 * as a bare `/api/_analog/pages/fr/catalog/index`, on `req.url` and on
 * `req.originalUrl` alike, and the SSR HTML carries the UNFILTERED catalogue.
 * The dev server has no `global.$fetch`, takes the plain-HTTP branch, and keeps
 * the query, which is why every e2e journey stayed green while prod was broken.
 *
 * The fix carries the search in a request header the interceptor does forward
 * (`analog-loader-query.interceptor.ts`), and every loader reads it through
 * `loaderSearchParams` (`lib/loader-query.ts`).
 *
 * Both request shapes are exercised on every loader: the dev shape (query on
 * the url) and the production shape (query ONLY on the header). The header
 * cases fail on the unfixed loaders, which is the point.
 */

/** A loader's call shape, erased to the boundary so all three share one signature. */
type LoaderFn = (arg: unknown) => Promise<unknown>;

/** Kept as a literal, not imported: the guard must pin the wire name itself. */
const QUERY_HEADER = 'x-analog-loader-query';

interface MinimalEvent {
  node: {
    req: { url: string; originalUrl: string; headers: Record<string, string> };
    res: {
      setHeader: () => unknown;
      getHeader: () => undefined;
      appendHeader: () => unknown;
    };
  };
}

function makeEvent(url: string, headers: Record<string, string> = {}): MinimalEvent {
  const res: MinimalEvent['node']['res'] = {
    setHeader: () => res,
    getHeader: () => undefined,
    appendHeader: () => res,
  };
  return {
    node: {
      // A page-endpoint event carries the same value on both, h3 assigns
      // `originalUrl = originalUrl || url`. Diverging them here would invent a
      // shape production never produces.
      req: { url, originalUrl: url, headers: { host: 'internal.test', ...headers } },
      res,
    },
  };
}

const recordedUrls: string[] = [];

/**
 * Stub `globalThis.fetch`, the loaders do NOT inject a fetchImpl, so the only
 * seam is the global. Categories answer a single object so the category loader
 * resolves its primary content; everything else answers an empty-but-valid
 * list envelope so each loader completes without throwing.
 */
const fetchStub = vi.fn(async (input: unknown): Promise<Response> => {
  const url = typeof input === 'string' ? input : String((input as Request).url);
  recordedUrls.push(url);
  const body = url.includes('/v1/categories/')
    ? { data: { id: 'cat-1', slug: 'shoes' } }
    : { data: [], meta: { total: 0 } };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});

beforeEach(() => {
  recordedUrls.length = 0;
  vi.stubGlobal('fetch', fetchStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The outbound call whose query the page's grid is built from. */
function listCall(path: string): URLSearchParams {
  const hit = recordedUrls.find((u) => u.includes(path));
  expect(hit, `no ${path} call recorded, got: ${recordedUrls.join(' | ')}`).toBeDefined();
  return new URL(hit as string, 'http://api.test').searchParams;
}

interface LoaderCase {
  name: string;
  load: LoaderFn;
  extraParams?: Record<string, string>;
  /** Internal endpoint path, as Nitro routes it, no query. */
  endpoint: string;
  /** The search a customer deep-linked. */
  search: string;
  /** The outbound API path whose query is the assertion target. */
  apiPath: string;
  /** Outbound param name → expected value, for the search above. */
  expected: Record<string, string>;
}

const CASES: LoaderCase[] = [
  {
    name: '/[locale]/catalog',
    load: catalogIndexLoad as unknown as LoaderFn,
    endpoint: '/api/_analog/pages/fr/catalog/index',
    search: 'brand=Nike&sortBy=price&sortOrder=asc&minPrice=50&maxPrice=249.999&specs=colour%3Ared',
    apiPath: '/v1/products',
    expected: {
      brand: 'Nike',
      sortBy: 'price',
      sortOrder: 'asc',
      minPrice: '50',
      maxPrice: '249.999',
      specs: 'colour:red',
    },
  },
  {
    name: '/[locale]/catalog/[slug]',
    load: categoryLoad as unknown as LoaderFn,
    extraParams: { slug: 'shoes' },
    endpoint: '/api/_analog/pages/fr/catalog/shoes',
    search: 'brand=Nike&sortBy=name&sortOrder=asc&minPrice=50&maxPrice=249.999&specs=colour%3Ared',
    apiPath: '/v1/products',
    expected: {
      brand: 'Nike',
      sortBy: 'name',
      sortOrder: 'asc',
      minPrice: '50',
      maxPrice: '249.999',
      specs: 'colour:red',
    },
  },
  {
    name: '/[locale]/search',
    load: searchLoad as unknown as LoaderFn,
    endpoint: '/api/_analog/pages/fr/search/index',
    search: 'q=lampe&page=2&sortBy=price&sortOrder=desc&brand=Nike&minPrice=50&maxPrice=249.999',
    apiPath: '/v1/search?',
    expected: {
      q: 'lampe',
      page: '2',
      sortBy: 'price',
      sortOrder: 'desc',
      brand: 'Nike',
      priceMin: '50',
      priceMax: '249.999',
    },
  },
];

describe.each(CASES)('$name forwards the deep-linked query', (loaderCase) => {
  const params = { locale: 'fr', ...(loaderCase.extraParams ?? {}) };

  it('reads it off the url (dev shape: plain-HTTP resolve keeps the search)', async () => {
    await loaderCase.load({
      params,
      event: makeEvent(`${loaderCase.endpoint}?${loaderCase.search}`),
    });

    const sent = listCall(loaderCase.apiPath);
    for (const [key, value] of Object.entries(loaderCase.expected)) {
      expect(sent.get(key), `${key} missing from the outbound query`).toBe(value);
    }
  });

  it('reads it off the header (production shape: the url carries no search)', async () => {
    await loaderCase.load({
      params,
      event: makeEvent(loaderCase.endpoint, { [QUERY_HEADER]: loaderCase.search }),
    });

    const sent = listCall(loaderCase.apiPath);
    for (const [key, value] of Object.entries(loaderCase.expected)) {
      expect(sent.get(key), `${key} missing from the outbound query`).toBe(value);
    }
  });

  it('prefers the url over a stale header', async () => {
    await loaderCase.load({
      params,
      event: makeEvent(`${loaderCase.endpoint}?${loaderCase.search}`, {
        [QUERY_HEADER]: 'brand=Stale&q=stale&sortBy=createdAt&sortOrder=desc',
      }),
    });

    const sent = listCall(loaderCase.apiPath);
    for (const [key, value] of Object.entries(loaderCase.expected)) {
      expect(sent.get(key), `${key} came from the header, not the url`).toBe(value);
    }
  });
});

describe('/[locale]/search bare-q short-circuit', () => {
  it('still short-circuits when neither the url nor the header carries q', async () => {
    const result = await (searchLoad as unknown as LoaderFn)({
      params: { locale: 'fr' },
      event: makeEvent('/api/_analog/pages/fr/search/index'),
    });

    expect(recordedUrls.length).toBe(0);
    expect(result).toMatchObject({ query: '', hits: [], totalCount: 0, facets: [] });
  });

  it('does not short-circuit when only the header carries q', async () => {
    const result = (await (searchLoad as unknown as LoaderFn)({
      params: { locale: 'fr' },
      event: makeEvent('/api/_analog/pages/fr/search/index', { [QUERY_HEADER]: 'q=lampe' }),
    })) as { query: string };

    expect(result.query).toBe('lampe');
    expect(listCall('/v1/search?').get('q')).toBe('lampe');
  });
});
