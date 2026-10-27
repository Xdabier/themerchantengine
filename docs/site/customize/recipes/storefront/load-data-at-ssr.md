---
title: Load data at SSR
description: "How a storefront page fetches at first byte: the .server.ts loader, the per-request API client, why the locale comes from the route params, why the query string rides a header on the production build, cookie forwarding, and the 304 short-circuit."
primaryQuery: ssr data loading analog nitro loader locale query cookies
updated: 2026-09-09
schema: HowTo
---

## When you need this

A public page must render with its data in the HTML: product, category, search results, CMS page. In this storefront that is a `.server.ts` file next to the page, exporting `load`. Analog compiles it to a Nitro endpoint and its router fetches that endpoint on every navigation, on the server and in the browser, so one fetch path serves both. The loader runs outside Angular's injector, and the request it receives is not the customer's request. This page walks the catalog loader, which reads a query string, and names each rule and the test that pins it.

## Files you touch

- `apps/storefront/src/app/pages/[locale]/catalog/index.server.ts`: the loader for `/{locale}/catalog`, which forwards sort and filter params.
- `apps/storefront/src/server/server-api-client-factory.ts`: `createServerApiClient(req, res, { locale })`, the per-request client.
- `apps/storefront/src/server/api-client.ts`: `createApiClient(ctx)`, the fetch wrapper that sets `Accept-Language`, forwards `Cookie`, pipes `Set-Cookie` back, and short-circuits 304.
- `apps/storefront/src/lib/locale.ts`: `routeLocale(params)`.
- `apps/storefront/src/lib/loader-query.ts` and `apps/storefront/src/app/analog-loader-query.interceptor.ts`: the query-string transport.
- `apps/storefront/src/app/app.config.ts`: interceptor order and the loader-404 handler.
- `apps/storefront/src/app/app.config.server.ts`: the `STOREFRONT_API_CLIENT` provider for code that runs inside Angular's SSR injector.
- `apps/storefront/src/server/store-config.ts`: the process-level cache of `GET /v1/store/config`.

## The pattern

### 1. Build the client from the event, once per request

`apps/storefront/src/app/pages/[locale]/catalog/index.server.ts` starts every loader the same way:

```ts
export const load = async ({ params: routeParams, event }: PageServerLoad) => {
  const apiClient = createServerApiClient(
    event.node.req as ServerRequest,
    event.node.res as ServerResponse,
    { locale: routeLocale(routeParams) },
  );
```

`createServerApiClient` in `apps/storefront/src/server/server-api-client-factory.ts` reads the inbound cookie header, the `x-request-id` header, builds a `Set-Cookie` sink on the response, and returns a fresh `ApiClient`. Never cache it across requests: cookies and request ids are per customer.

### 2. Take the locale from the route params

Inside a Nitro page endpoint `req.url` is the internal `/api/_analog/pages/<locale>/...` path. `localeFromPathname` is anchored on `/{locale}/` and reads that as null, and the factory would fall back to the default locale on every page. `apps/storefront/src/lib/locale.ts`:

```ts
export function routeLocale(params: Record<string, unknown> | null | undefined): Locale | null {
  const raw = params?.['locale'];
  return typeof raw === 'string' && isLocale(raw) ? raw : null;
}
```

The factory's resolution order is `options.locale`, then the URL prefix (only right for the Angular SSR-DI provider, whose request is the clean `/{locale}/...` URL), then `DEFAULT_LOCALE`. `apps/storefront/src/app/pages/[locale]/ssr-loaders-locale.spec.ts` feeds every loader the internal URL shape and asserts the outbound `Accept-Language` follows `params.locale`; add a new loader to its list.

### 3. Read the query through the header fallback

On a production Nitro build Analog's `requestContextInterceptor` resolves the endpoint over an internal `$fetch` of `requestUrl.pathname` and tries to restore the search with ofetch's `params` option. ofetch spreads that option, and `{ ...new URLSearchParams('a=1') }` is `{}`, so the endpoint receives no query on `req.url` or `req.originalUrl`. The dev server has no `global.$fetch`, takes the plain HTTP branch, and keeps the URL, which is why the Playwright suite cannot see this.

`apps/storefront/src/app/analog-loader-query.interceptor.ts` copies the search onto a header that branch does forward:

```ts
export const analogLoaderQueryInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isPlatformServer(inject(PLATFORM_ID))) return next(req);
  if (!req.url.includes('/_analog/')) return next(req);
  const beforeHash = req.url.split('#')[0];
  const start = beforeHash.indexOf('?');
  if (start < 0) return next(req);
  const search = beforeHash.slice(start + 1);
  if (search.length === 0) return next(req);
  return next(req.clone({ setHeaders: { [LOADER_QUERY_HEADER]: search } }));
};
```

It is registered before Analog's interceptor in `apps/storefront/src/app/app.config.ts`, because that one answers the request itself and never calls `next`:

```ts
provideHttpClient(
  withFetch(),
  withInterceptors([analogLoaderQueryInterceptor, requestContextInterceptor]),
),
```

The loader reads the query with `loaderSearchParams(req)` from `apps/storefront/src/lib/loader-query.ts`, which prefers the URL when it carries a search and falls back to the `x-analog-loader-query` header:

```ts
const params = loaderSearchParams(event.node.req as ServerRequest);
const sort = resolveCatalogSort(params.get('sortBy'), params.get('sortOrder'));
query['sortBy'] = sort.sortBy;
query['sortOrder'] = sort.sortOrder;
const brand = params.get('brand');
if (brand) query['brand'] = brand;
```

Forward each parameter explicitly into the `query` option of `apiClient.get`. Never parse `event.node.req.url` in a loader.

### 4. Forward cookies, pipe Set-Cookie back, treat 401 as anonymous

`apps/storefront/src/server/api-client.ts` sends the inbound cookie header verbatim and writes any `Set-Cookie` from the API onto the storefront response:

```ts
const headers = new Headers({
  Accept: 'application/json',
  'Accept-Language': ctx.locale,
  'X-Request-Id': requestId,
});
if (ctx.cookieHeader) headers.set('Cookie', ctx.cookieHeader);
if (isWriteMethod(method)) headers.set('X-Requested-With', 'XMLHttpRequest');
// ...
pipeSetCookies(response, ctx.setCookie);

if (response.status === 401 && rawOptions?.allow401AsNull) {
  return null as T;
}
```

The server client never refreshes a session; a route that also renders anonymously passes `allow401AsNull` and draws the logged-out shell, and the browser's boot resolves the real session after hydration. `apps/storefront/src/server/api-client.spec.ts` pins the `Cookie` forward and the `Set-Cookie` pipe.

### 5. Treat 304 as success

The same file, before the `!response.ok` branch:

```ts
if (response.status === 304) {
  return undefined as T;
}
```

The API sends `Cache-Control: no-store` by default and the SSR fetch never sends `If-None-Match`, so a 304 should not arrive. The guard exists so a cache-config regression cannot turn every page into a generic error. `libs/storefront-services/src/lib/shared/browser-api-client.ts` carries the same guard for the browser.

### 6. Fail the right way

Primary content that is missing throws `createError({ statusCode: 404 })` from `h3`; secondary content soft-fails to a default with `.catch(() => [])`, as the catalog loader does for its facets. A loader 404 rejects the router's resolver and would otherwise cancel navigation into an empty shell under a 200; `apps/storefront/src/app/app.config.ts` catches it with `withNavigationErrorHandler` and redirects to `/{locale}/not-found` (predicate in `apps/storefront/src/lib/loader-navigation-error.ts`: a 404, and only on a `/_analog/pages` URL). A 500 on primary content propagates as 500.

## Tests to run

```bash
npx nx test storefront
npx nx build storefront --configuration=production
npm run test:storefront-ssr-smoke
npx nx e2e storefront-e2e --grep=catalog-query-ssr
npx nx e2e storefront-e2e --grep=loader-404
```

- `npx nx test storefront` runs `ssr-loaders-locale.spec.ts`, `ssr-loaders-query.spec.ts` (both request shapes on every query-bearing loader: query on the URL, query only on the header), `analog-loader-query.interceptor.spec.ts`, `apps/storefront/src/lib/loader-query.spec.ts` and `apps/storefront/src/server/api-client.spec.ts`. Both `ssr-loaders-*` specs are table-driven from a `CASES` array; a new loader that reads a query is one more entry. The row shape in `apps/storefront/src/app/pages/[locale]/ssr-loaders-query.spec.ts` (lines 104-116):

```ts
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
```

  The catalog row uses `endpoint: '/api/_analog/pages/fr/catalog/index'`, `search: 'brand=Nike&sortBy=price&sortOrder=asc...'` and `apiPath: '/v1/products'`; `describe.each(CASES)` runs each row three times (search on the URL, search only on the header, URL preferred over a stale header) and asserts the outbound query holds `expected`. `ssr-loaders-locale.spec.ts` has its own `CASES` (line 89, one row per loader with a `urlSuffix`) and takes every loader, query-bearing or not.
- The production build plus `npm run test:storefront-ssr-smoke` is the only layer that takes the production request path. It boots `dist/apps/storefront/analog/server/index.mjs` on 53311 against the test API on 53001 and asserts, from the served HTML, that a filtered catalog URL, a search URL and a category deep link render the narrowed grid. Exit code 1 is a page rendered wrong; 2 is a harness or fixture problem.
- `catalog-query-ssr.journey.spec.ts` covers the dev-server path; `loader-404.journey.spec.ts` asserts an unknown slug answers a real 404 with the not-found component mounted.

## Gotchas

- Do not set `VITE_ANALOG_PUBLIC_BASE_URL`. Analog's resolver reads it to answer page endpoints with `globalThis.$fetch(url.pathname)` instead of `HttpClient`, which skips every interceptor and drops the query again with nothing red anywhere (`apps/storefront/vite.config.ts`).
- Assertions on the filter rail, the sort control or the search heading are green forever: the components re-read the query from the Angular route snapshot. Only the loader payload (the ordered `data-product-slug` list, the result count) can prove the query reached the server.
- The browser caches the loader payload under the pathname in `TransferState`. A wrong SSR payload is not repaired after hydration.
- Do not `inject()` an Angular service in a loader; it runs as an h3 handler outside the injector. `STOREFRONT_API_CLIENT` from `app.config.server.ts` is for chrome components that render inside the Angular SSR pass.
- `createApiClient` resolves `path` against `baseUrl` only and never honours an absolute URL, so a loader cannot be steered to another host by request input.
- `apps/storefront/src/server/store-config.ts` caches the runtime config for sixty seconds per process and five seconds after a failure. The neutral config is what renders while the API is down.
- Port 53311 is shared by `serve-production`, the e2e dev server, the payload verifier and Lighthouse. The smoke refuses to run when something already answers there; move it with `STOREFRONT_SMOKE_PORT`.
