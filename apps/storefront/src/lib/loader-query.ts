/**
 * The one place that decides where a page-server companion reads its query
 * string from.
 *
 * THE BUG THIS FIXES. A page-server companion (`pages/**\/*.server.ts`) is
 * resolved over HTTP by Analog's route resolver, and on a production Nitro
 * build `requestContextInterceptor` (`@analogjs/router` 2.4.10) takes its
 * internal-`$fetch` branch:
 *
 *     const fetchUrl = requestUrl.pathname;                  // search dropped
 *     global.$fetch.raw(fetchUrl, { params: requestUrl.searchParams, ... })
 *
 * `params` was meant to put the search back, and cannot: ofetch merges that
 * option with an object spread, and `{ ...new URLSearchParams('a=1') }` is `{}`
 * because a `URLSearchParams` has no own enumerable properties. So the request
 * that reaches the endpoint carries no query at all, on `req.url` and on
 * `req.originalUrl` alike, since h3 assigns `originalUrl = originalUrl || url`.
 * A deep link to `/fr/catalog?brand=X` server-rendered the whole catalogue,
 * `/fr/search?q=lampe` server-rendered the empty-results CTA, and neither
 * repaired itself after hydration: the cache key Analog stores the payload
 * under is the pathname, so the browser restores the unfiltered response from
 * TransferState and issues no corrective fetch.
 *
 * It only ever broke in production. The Vite dev server has no `global.$fetch`,
 * so the interceptor falls through to a plain HTTP request that keeps the full
 * url, which is why the storefront e2e suite, which runs `nx serve storefront`,
 * could not see it.
 *
 * The fix rides the one thing that branch does forward verbatim: request
 * headers. `analogLoaderQueryInterceptor` copies the search onto
 * `LOADER_QUERY_HEADER` before Analog's interceptor runs, and every loader
 * reads the query through `loaderSearchParams` instead of parsing the url
 * itself. The url stays authoritative wherever it has one, so the dev and
 * browser paths behave exactly as before and the header is dead weight there.
 *
 * When Analog fixes the interceptor upstream the header becomes redundant
 * rather than wrong, and this module can be deleted in one pass.
 */

/**
 * Carries the deep-linked search string across Analog's internal `$fetch`.
 * Lower-case: Node normalises inbound header names, and `IncomingHttpHeaders`
 * is keyed that way.
 */
export const LOADER_QUERY_HEADER = 'x-analog-loader-query';

/** The inbound-request surface a loader actually has. */
interface LoaderRequest {
  url?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}

function headerValue(req: LoaderRequest): string {
  // Node lower-cases inbound header names and the interceptor sends the name
  // lower-cased, so the direct hit is the normal path. The scan is there because
  // the whole fix turns on finding this one value, and a casing surprise
  // anywhere between Angular and Nitro would fail silently and look exactly like
  // the defect it repairs.
  const entry =
    req.headers[LOADER_QUERY_HEADER] ??
    Object.entries(req.headers).find(([name]) => name.toLowerCase() === LOADER_QUERY_HEADER)?.[1];
  if (Array.isArray(entry)) return entry[0] ?? '';
  return entry ?? '';
}

/**
 * The query a loader should build its API call from.
 *
 * The url wins whenever it carries a search, so a request that reaches the
 * endpoint intact, the dev server, a browser-side navigation, a direct call to
 * `/api/_analog/pages/...`, never depends on the header. The header is the
 * fallback for the production internal-`$fetch` path, where the url has none.
 */
export function loaderSearchParams(req: LoaderRequest): URLSearchParams {
  const search = new URL(req.url ?? '/', 'http://loader.invalid').search;
  return new URLSearchParams(search.length > 0 ? search : headerValue(req));
}
