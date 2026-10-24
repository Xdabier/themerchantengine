import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { load as homeLoad } from './index.server';
import { load as aboutLoad } from './about.server';
import { load as policyLoad } from './policies/[slug].server';
import { load as catalogIndexLoad } from './catalog/index.server';
import { load as categoryLoad } from './catalog/[slug].server';
import { load as productLoad } from './catalog/product/[slug].server';
import { load as searchLoad } from './search/index.server';

/**
 * SSR locale split-brain regression guard — per-loader coverage.
 *
 * Each `[locale]/**` page-server companion builds its `ApiClient` from the
 * inbound h3 event, whose url at the Nitro page-endpoint layer is the INTERNAL
 * `/api/_analog/pages/<locale>/...` path — NOT the user-facing `/{locale}/...`
 * route. `localeFromPathname` is start-anchored on `/{locale}/`, reads that url
 * as null, and the factory falls back to DEFAULT_LOCALE='fr'. The fix is one
 * line per loader: pass the authoritative `[locale]` route param via
 * `routeLocale(params)`. These tests feed the REAL internal-endpoint url shape
 * and assert the outbound `Accept-Language` follows `params.locale`, NOT the
 * url — so a future loader that silently drops the route param regresses red.
 *
 * No `*.server.spec.ts` existed before this fix (see plan §7.2).
 */

/** A loader's call shape, erased to the boundary so all 7 share one signature. */
type LoaderFn = (arg: unknown) => Promise<unknown>;

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

function makeEvent(url: string): MinimalEvent {
  const res: MinimalEvent['node']['res'] = {
    setHeader: () => res,
    getHeader: () => undefined,
    appendHeader: () => res,
  };
  return {
    node: {
      req: { url, originalUrl: url, headers: { host: 'internal.test' } },
      res,
    },
  };
}

const recordedInits: RequestInit[] = [];

/**
 * Stub `globalThis.fetch` — the loaders do NOT inject a fetchImpl, so the only
 * seam is the global. Every endpoint returns a uniform empty-but-valid envelope
 * so each loader's primary (hard-fail) call resolves and the loader completes
 * without throwing; the secondary calls are soft-fail / caught regardless.
 */
const fetchStub = vi.fn(async (_input: unknown, init?: RequestInit): Promise<Response> => {
  recordedInits.push(init ?? {});
  return new Response(JSON.stringify({ data: [], meta: { total: 0 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});

beforeEach(() => {
  recordedInits.length = 0;
  vi.stubGlobal('fetch', fetchStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface LoaderCase {
  name: string;
  load: LoaderFn;
  /** Non-locale route params the loader requires (e.g. slug). */
  extraParams?: Record<string, string>;
  /** Appended to the internal `/api/_analog/pages/<locale>` base. */
  urlSuffix: string;
}

const CASES: LoaderCase[] = [
  { name: '/[locale]/ (home)', load: homeLoad as unknown as LoaderFn, urlSuffix: '/' },
  { name: '/[locale]/about', load: aboutLoad as unknown as LoaderFn, urlSuffix: '/about' },
  {
    name: '/[locale]/policies/[slug]',
    load: policyLoad as unknown as LoaderFn,
    extraParams: { slug: 'privacy' },
    urlSuffix: '/policies/privacy',
  },
  {
    name: '/[locale]/catalog',
    load: catalogIndexLoad as unknown as LoaderFn,
    urlSuffix: '/catalog',
  },
  {
    name: '/[locale]/catalog/[slug]',
    load: categoryLoad as unknown as LoaderFn,
    extraParams: { slug: 'shoes' },
    urlSuffix: '/catalog/shoes',
  },
  {
    name: '/[locale]/catalog/product/[slug]',
    load: productLoad as unknown as LoaderFn,
    extraParams: { slug: 'urban-runner-sneakers' },
    urlSuffix: '/catalog/product/urban-runner-sneakers',
  },
  {
    // The non-empty-`q` branch is the one that builds a client (the bare-`q`
    // short-circuit returns synchronously and is exercised separately below).
    name: '/[locale]/search',
    load: searchLoad as unknown as LoaderFn,
    urlSuffix: '/search?q=test',
  },
];

describe.each(CASES)(
  '$name loader threads params.locale into Accept-Language',
  ({ load, extraParams, urlSuffix }) => {
    for (const locale of ['en', 'fr'] as const) {
      it(`sends Accept-Language: ${locale} from params.locale despite the internal _analog url`, async () => {
        const params = { locale, ...(extraParams ?? {}) };
        const url = `/api/_analog/pages/${locale}${urlSuffix}`;

        await load({ params, event: makeEvent(url) });

        // The loader must have built a client and fired ≥1 outbound call.
        expect(recordedInits.length).toBeGreaterThan(0);
        // Every call carries the route-param locale — never the DEFAULT_LOCALE
        // 'fr' the misleading url would otherwise produce.
        for (const init of recordedInits) {
          expect(new Headers(init.headers).get('Accept-Language')).toBe(locale);
        }
      });
    }
  },
);

describe('/[locale]/search bare-q short-circuit', () => {
  it('builds no client (issues no fetch) when ?q is absent', async () => {
    const result = await (searchLoad as unknown as LoaderFn)({
      params: { locale: 'en' },
      event: makeEvent('/api/_analog/pages/en/search'),
    });

    expect(recordedInits.length).toBe(0);
    expect(result).toMatchObject({ query: '', hits: [], totalCount: 0, facets: [] });
  });
});
