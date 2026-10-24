import { defineEventHandler, sendRedirect, setResponseStatus } from 'h3';

import { isLocale } from '../../i18n/types';
import { readStoreConfig } from '../store-config';

/**
 * Storefront Nitro middleware. Serves `SeoRedirect` rows, and turns an unknown
 * slug into a real 404.
 *
 * WHY IT LIVES HERE AND NOT ON THE API
 *
 * `SeoRedirectMiddleware` is mounted on the API (`seo.module.ts`), but every row
 * it looks up is a STOREFRONT path: the seed pipeline mints
 * `/{locale}/catalog/product/{slug}`. nginx routes `/v1/` to the API and
 * everything else to this Nitro server, so a request for a `fromPath` never
 * reached the process that owned the lookup. Every row was inert. Verified on
 * production 2026-09-02: an old URL answered 200 rather than redirecting.
 *
 * The old `verify` gate reported green throughout, because it only asserted that
 * a redirect's TARGET resolves and that no row self-loops. It never requested a
 * `fromPath`, so it could not observe that nothing redirected.
 *
 * WHY THE 404 IS HERE TOO
 *
 * In a production build Analog exposes each page loader as an internal endpoint
 * under `/api/_analog/pages/...` and the SSR render fetches it. A loader that
 * throws `createError({ statusCode: 404 })` therefore 404s the INNER fetch while
 * the OUTER page render still answers 200 with an error shell. The dev server
 * does not split those, which is why dev answers 404 and production does not:
 * measured 2026-09-02, dev 404 on all four slug routes, production 200 on all
 * four. Angular 21 exposes `RESPONSE_INIT` for exactly this, but Analog 2.4.10
 * does not read it (no reference in the SSR renderer), so the status has to be
 * set at the edge.
 *
 * A soft 404 is not cosmetic: it is invisible to an uptime check, it reads to a
 * crawler as a thin duplicate rather than a removal, and it makes a redirect
 * unobservable because there is no failure to redirect away from.
 */

/** Routes that carry a slug, mapped to the API resource that decides existence. */
const SLUG_ROUTES: { pattern: RegExp; resource: (slug: string) => string }[] = [
  {
    pattern: /^\/[a-z]{2}\/catalog\/product\/([^/]+)\/?$/,
    resource: (slug) => `/v1/products/${slug}`,
  },
  {
    // `/catalog` itself and `/catalog/product/...` are excluded by the negative
    // lookahead, or the catalogue landing page would be existence-checked as a
    // category and 404 on every request.
    pattern: /^\/[a-z]{2}\/catalog\/(?!product\/)([^/]+)\/?$/,
    resource: (slug) => `/v1/categories/${slug}`,
  },
  { pattern: /^\/[a-z]{2}\/pages\/([^/]+)\/?$/, resource: (slug) => `/v1/pages/${slug}` },
  { pattern: /^\/[a-z]{2}\/policies\/([^/]+)\/?$/, resource: (slug) => `/v1/pages/${slug}` },
];

interface RedirectRow {
  fromPath: string;
  toPath: string;
  permanent: boolean;
}

/**
 * The whole redirect table, cached in process.
 *
 * Fetched as one map rather than per request because the table is small by
 * construction (one row per moved URL per locale) and a per-request lookup would
 * put an API round trip in front of every page view for a table that is empty
 * most of the time.
 */
let redirectCache: { at: number; rows: Map<string, RedirectRow> } | null = null;
const REDIRECT_TTL_MS = 5 * 60_000;

function apiBase(): string {
  return (
    process.env['STOREFRONT_API_URL'] ??
    process.env['API_URL'] ??
    'http://localhost:53000/api'
  ).replace(/\/$/, '');
}

async function loadRedirects(): Promise<Map<string, RedirectRow>> {
  const now = Date.now();
  if (redirectCache && now - redirectCache.at < REDIRECT_TTL_MS) return redirectCache.rows;
  const rows = new Map<string, RedirectRow>();
  try {
    const res = await fetch(`${apiBase()}/v1/seo/redirects`, {
      headers: { accept: 'application/json' },
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: RedirectRow[] };
      // The API wraps every payload in `{ data }`. Guard the shape rather than
      // trusting it: an envelope change here fails open and silently disables
      // every redirect, which is exactly how the previous version stayed broken.
      const list = Array.isArray(body?.data) ? body.data : [];
      for (const row of list) {
        if (row?.fromPath && row?.toPath) rows.set(row.fromPath, row);
      }
    }
  } catch {
    // Fail open. A redirect table that cannot be fetched must never take the
    // storefront down; the page renders as though the row did not exist.
  }
  redirectCache = { at: now, rows };
  return rows;
}

/**
 * Every spelling of a path a lookup might need.
 *
 * The wire carries a percent-encoded path, while the rows hold decoded UTF-8
 * because the seed mints them from product names. A French catalogue is full of
 * accents, so a naive `map.get(rawPath)` misses every row that needs one. The
 * SSR smoke gate caught this on the first row it probed:
 * `/fr/catalog/product/1s-lampe-%C3%A0-polym%C3%A9riser-led` answered 404
 * instead of redirecting. Trailing-slash variants are here for the same reason:
 * one URL to a reader, two strings to a Map.
 */
function lookupKeys(path: string): string[] {
  const keys = new Set<string>();
  const add = (value: string) => {
    if (!value) return;
    keys.add(value);
    keys.add(value.endsWith('/') ? value.replace(/\/+$/, '') : `${value}/`);
  };
  add(path);
  try {
    add(decodeURIComponent(path));
  } catch {
    // A malformed escape is not a reason to fail the request.
  }
  return [...keys];
}

/**
 * Paths that are known to exist, warmed from the sitemaps.
 *
 * This is what keeps the 404 check off the hot path. The first version asked the
 * API "does this slug exist?" on EVERY slug-route request, which put a second
 * round trip in front of every product page the storefront renders, to answer a
 * question the page loader was already about to answer. That is a real cost paid
 * by every genuine visitor to protect against a rare bad URL.
 *
 * The sitemaps are the right source: they are generated from the same catalogue,
 * they already carry the exact locale-prefixed paths this middleware matches on,
 * and the API already caches them for an hour. Three fetches every ten minutes
 * replaces one fetch per page view.
 *
 * A hit is free and definitive. A MISS is not treated as absent, because a
 * sitemap lists indexable pages and can lag a publish by minutes: a miss falls
 * through to a single verified check below. So the only traffic that pays is
 * traffic for a path that is genuinely not in the catalogue, which is exactly
 * the traffic that should pay.
 */
let knownPaths: { at: number; paths: Set<string> } | null = null;
const KNOWN_TTL_MS = 10 * 60_000;

const SITEMAPS = ['sitemap-products.xml', 'sitemap-categories.xml', 'sitemap-pages.xml'];

async function loadKnownPaths(): Promise<Set<string>> {
  const now = Date.now();
  if (knownPaths && now - knownPaths.at < KNOWN_TTL_MS) return knownPaths.paths;

  const paths = new Set<string>();
  await Promise.all(
    SITEMAPS.map(async (name) => {
      try {
        const res = await fetch(`${apiBase()}/v1/${name}`, {
          headers: { accept: 'application/xml' },
        });
        if (!res.ok) return;
        const xml = await res.text();
        for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
          try {
            paths.add(new URL(m[1]).pathname.replace(/\/+$/, '') || '/');
          } catch {
            // A malformed <loc> is skipped rather than poisoning the whole set.
          }
        }
      } catch {
        // Fail open: an unreachable sitemap must not turn the catalogue into 404s.
      }
    }),
  );

  // An empty result is not cached as authoritative. Caching it would make every
  // path a miss for the next ten minutes and push all traffic onto the slow path
  // during exactly the API outage that produced the empty result.
  if (paths.size > 0) knownPaths = { at: now, paths };
  return paths;
}

/**
 * Verification for a path the warm set does not know, cached briefly.
 *
 * Reached only on a miss, so a real product costs nothing once the set is warm.
 */
const existsCache = new Map<string, { at: number; exists: boolean }>();
const EXISTS_TTL_MS = 60_000;
const EXISTS_CACHE_MAX = 5_000;

async function resourceExists(resourcePath: string, locale: string): Promise<boolean> {
  const key = `${locale}:${resourcePath}`;
  const hit = existsCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < EXISTS_TTL_MS) return hit.exists;

  let exists = true;
  try {
    const res = await fetch(`${apiBase()}${resourcePath}`, {
      headers: { accept: 'application/json', 'accept-language': locale },
    });
    // Only a definite 404 counts as absent. A 5xx, a timeout or a rate limit must
    // never manufacture a 404 for a page that exists: that would deindex real
    // products during an API blip, which is worse than the soft 404 being fixed.
    exists = res.status !== 404;
  } catch {
    exists = true;
  }

  if (existsCache.size >= EXISTS_CACHE_MAX) existsCache.clear();
  existsCache.set(key, { at: now, exists });
  return exists;
}

/** Query strings survive a redirect: a campaign tag must not be dropped by it. */
function withQuery(toPath: string, url: string): string {
  const q = url.indexOf('?');
  if (q === -1) return toPath;
  return toPath.includes('?') ? `${toPath}&${url.slice(q + 1)}` : `${toPath}${url.slice(q)}`;
}

export default defineEventHandler(async (event) => {
  const url = event.node.req.url ?? '/';
  const path = url.split('?')[0];

  // Never touch an asset, an internal Analog page endpoint, or the API proxy.
  if (
    path.startsWith('/api/') ||
    path.startsWith('/_') ||
    path.startsWith('/brand/') ||
    path.startsWith('/fonts/') ||
    /\.[a-z0-9]{2,5}$/i.test(path)
  ) {
    return;
  }

  const redirects = await loadRedirects();
  let row: RedirectRow | undefined;
  for (const key of lookupKeys(path)) {
    row = redirects.get(key);
    if (row) break;
  }
  if (row) {
    return sendRedirect(event, withQuery(row.toPath, url), row.permanent ? 301 : 302);
  }

  for (const route of SLUG_ROUTES) {
    const match = route.pattern.exec(path);
    if (!match) continue;

    // Free path: the sitemaps already say this page exists.
    const known = await loadKnownPaths();
    const trimmed = path.replace(/\/+$/, '') || '/';
    let decoded = trimmed;
    try {
      decoded = decodeURIComponent(trimmed);
    } catch {
      // Keep the raw form; a malformed escape is handled by the check below.
    }
    if (known.has(trimmed) || known.has(decoded)) return;

    const locale = path.split('/')[1];
    const resolved = isLocale(locale)
      ? locale
      : (await readStoreConfig()).localization.defaultLocale;
    const slug = decodeURIComponent(match[1]);
    if (!(await resourceExists(route.resource(slug), resolved))) {
      // The render still runs and the error shell still paints; only the status
      // is corrected. Returning early instead would replace a designed error
      // page with a bare body.
      setResponseStatus(event, 404);
    }
    return;
  }
});

/** Test seam: drop both caches so a spec can control what the middleware sees. */
export function __resetSeoRedirectCaches(): void {
  redirectCache = null;
  knownPaths = null;
  existsCache.clear();
}
