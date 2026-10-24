---
title: Reference implementation
description: "How the shipped Analog.js storefront meets each of the ten obligations: the files, the functions and a real excerpt from each, so you can read a working answer."
primaryQuery: analog angular storefront reference implementation cookie forwarding idempotency 304
updated: 2026-09-09
schema: TechArticle
---

The shipped storefront is an Analog.js app on Angular with a Nitro server. Pages live under `apps/storefront/src/app/pages/[locale]/`, one directory per route with an optional `.server.ts` loader beside the page; the API services are in `libs/storefront-services`, the types and Zod schemas in `libs/storefront-types`, and the server routes, middleware and the two API clients under `apps/storefront/src/server/`. Where each piece sits in the whole tree is on [Repository layout](../customize/repository-layout.md#the-storefront). Every section below is one obligation of [the contract](./index.md#the-ten-obligations), with the file that meets it and an excerpt; comments are trimmed from the excerpts, so open the file for the reasoning.

## 1. The store config

`readStoreConfig` in `apps/storefront/src/server/store-config.ts` reads `GET /v1/store/config` for the code that runs before Angular does (the root locale redirect in `apps/storefront/src/server/middleware/locale-redirect.ts`). One in-flight request, a sixty-second cache per process, five seconds after a failure, and the committed neutral config when the API is down. Excerpt from `apps/storefront/src/server/store-config.ts`:

```ts
export async function readStoreConfig(
  fetchImpl: typeof fetch = fetch,
): Promise<StorefrontRuntimeConfig> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;
  if (failedUntil > now) return NEUTRAL_STOREFRONT_RUNTIME_CONFIG;
  inFlight ??= fetchConfig(fetchImpl)
    .then((value) => {
      if (value === NEUTRAL_STOREFRONT_RUNTIME_CONFIG) {
        failedUntil = Date.now() + FAILURE_TTL_MS;
      } else {
        cache = { value, expiresAt: Date.now() + TTL_MS };
        failedUntil = 0;
      }
      return value;
    })
```

Inside Angular, `StoreConfigService` in `apps/storefront/src/app/services/store-config.service.ts` loads the same config on the server pass, carries it to the browser through `TransferState`, and exposes `money()`, `localization()`, `brand()`, `identity()` and `domains()` as signals. `BrandTokensService` in `apps/storefront/src/app/services/brand-tokens.service.ts` turns `brand.generatedPalette` and `brand.fontKit` into a `:root` block in the document head, `LocaleService` in `apps/storefront/src/app/locale.service.ts` sets `dir` on `<html>` from `localization.rtlLocales`, and `formatMoney` in `apps/storefront/src/lib/money.ts` formats every price from the `money` block. Excerpt from `apps/storefront/src/app/services/brand-tokens.service.ts`:

```ts
  cssText(): string | null {
    const brand = this.storeConfig.brand();
    const palette = brand.generatedPalette;
    if (!palette) return null;
    const kit = FONT_KITS[brand.fontKit] ?? FONT_KITS['latin-rounded'];
    const declarations = [
      ...Object.entries(palette.tokens).map(([token, value]) => `  ${token}: ${value};`),
      `  --brand-kit-display: ${kit.display};`,
```

## 2. `Accept-Language` on every call

The browser client reads the locale once from `<html lang>` and sets both `Accept-Language` and `X-Locale` on every request; the server client takes it from the matched `[locale]` route parameter. Excerpt from `createBrowserApiClient` in `libs/storefront-services/src/lib/shared/browser-api-client.ts`:

```ts
    const requestId = rawOptions?.requestId ?? generateRequestId();
    const headers = new Headers({
      Accept: 'application/json',
      'Accept-Language': locale,
      'X-Locale': locale,
      'X-Request-Id': requestId,
    });
    if (isWriteMethod(method)) headers.set('X-Requested-With', 'XMLHttpRequest');
    if (rawOptions?.idempotencyKey) headers.set('X-Idempotency-Key', rawOptions.idempotencyKey);
```

`resolveBrowserLocale` in the same file is exported so the Better Auth client in `libs/storefront-services/src/lib/auth/auth-client.ts` sends the same two headers from the same source. On the server, `createServerApiClient` in `apps/storefront/src/server/server-api-client-factory.ts` resolves `options.locale ?? localeFromPathname(req.originalUrl ?? req.url ?? '') ?? DEFAULT_LOCALE` and every loader passes `routeLocale(params)`, as [Load data at SSR](../customize/recipes/storefront/load-data-at-ssr.md) walks through.

## 3. The two cookies

In the browser, `fetch` runs with `credentials: 'include'` and the Better Auth client has the same default, so the session cookie and the `sessionId` cart cookie travel on their own. On the server, `createApiClient` in `apps/storefront/src/server/api-client.ts` forwards the inbound `Cookie` header and pipes every `Set-Cookie` back. Excerpt from `apps/storefront/src/server/api-client.ts`:

```ts
    const headers = new Headers({
      Accept: 'application/json',
      'Accept-Language': ctx.locale,
      'X-Request-Id': requestId,
    });
    if (ctx.cookieHeader) headers.set('Cookie', ctx.cookieHeader);
    if (isWriteMethod(method)) headers.set('X-Requested-With', 'XMLHttpRequest');
    if (rawOptions?.idempotencyKey) headers.set('X-Idempotency-Key', rawOptions.idempotencyKey);
```

and, after the response arrives:

```ts
    pipeSetCookies(response, ctx.setCookie);
```

`pipeSetCookies` prefers `response.headers.getSetCookie()` so several cookies from one upstream answer are kept apart. The sink it writes to is built per request by `makeSetCookieSink` in `apps/storefront/src/server/server-api-client-factory.ts`, which calls `res.appendHeader('set-cookie', value)` rather than `setHeader`, because a render can make more than one API call that sets a cookie. The factory never caches a client across requests: the cookie and the request id are per visitor.

## 4. `304` and caching

Both clients return before the `!response.ok` branch when the status is `304`. Excerpt from `libs/storefront-services/src/lib/shared/browser-api-client.ts`:

```ts
    if (response.status === 204) {
      return undefined as T;
    }

    if (response.status === 304) {
      return undefined as T;
    }

    const text = await response.text();
```

The server client in `apps/storefront/src/server/api-client.ts` carries the same lines. `mapHttpErrorToStorefrontError` in `libs/storefront-types/src/lib/shared/errors.ts` logs a console error if a `304` ever reaches it, so a regression in either client is visible the first time it happens. Nothing in the storefront caches an API response that depends on a cookie: the only caches are the process-level store config above and the Nitro page cache the revalidation route invalidates.

## 5. The atomic boot

`boot()` in `apps/storefront/src/app/layout/layout-shell.component.ts` runs once per browser mount behind an `isPlatformBrowser` gate, makes one `getSession()` call, commits the user in one `setSession` or not at all, and settles the boot in a `finally`. Excerpt from `apps/storefront/src/app/layout/layout-shell.component.ts`:

```ts
  private async boot(): Promise<void> {
    try {
      const user = await this.auth.getSession();
      if (user) {
        this.authState.setSession({ user });
      }
    } catch (err: unknown) {
      console.warn('[layout-shell] unexpected failure resolving the session', err);
    } finally {
      this.authState.markBooted();
    }
```

`getSession` in `libs/storefront-services/src/lib/auth/auth.service.ts` returns `null` for a logged-out visitor, a transient `429` or `5xx` and a body that fails the `customerUserSchema` parse alike, so the boot never has a partial user to commit and never clears anything. `AuthStateService` in `apps/storefront/src/app/services/auth-state.service.ts` holds the signals; `markBooted` is idempotent and the server pass never calls it. After the boot the shell merges the anonymous cart into the customer's (`cart.merge()`) only when a session was committed, then hydrates the cart count.

## 6. The idempotency key

`OrdersService.create` in `libs/storefront-services/src/lib/orders/orders.service.ts` takes the key as its second argument and validates it before the request leaves. Excerpt from `libs/storefront-services/src/lib/orders/orders.service.ts`:

```ts
  async create(input: CreateOrderRequest, idempotencyKey: string): Promise<Order> {
    const body = createOrderRequestSchema.parse(input);
    z.string().uuid().parse(idempotencyKey);
    const envelope = await this.api.post<unknown>('/v1/orders', body, { idempotencyKey });
    return apiResponseSchema(orderSchema).parse(envelope).data;
  }
```

The checkout page in `apps/storefront/src/app/pages/[locale]/checkout/index.page.ts` owns the key as a signal, sets it once when the cart loads and reuses it on every submit of that cart snapshot, so a failed request, a `409` and a page re-mount all retry with the same key. Excerpt from `apps/storefront/src/app/pages/[locale]/checkout/index.page.ts`:

```ts
      if (!this.idempotencyKey()) {
        this.idempotencyKey.set(crypto.randomUUID());
      }
      this.state.set('ready');
```

## 7. Error codes in every locale

The typed errors in `libs/storefront-types/src/lib/shared/errors.ts` carry `code` from the envelope, and every page maps the code to a string from the active locale's catalogue. The catalogues are `apps/storefront/src/i18n/en.ts`, `apps/storefront/src/i18n/fr.ts` and `apps/storefront/src/i18n/ar.ts`, all typed by `apps/storefront/src/i18n/types.ts`, so a string missing in one locale does not compile. Excerpt from `placeOrderErrorMessageFor` in `apps/storefront/src/app/pages/[locale]/checkout/index.page.ts`:

```ts
    const errors = this.strings().checkout.errors;
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? String((err as { code: string }).code)
        : null;
    if (code === 'ORDER_INSUFFICIENT_STOCK') return errors.outOfStock;
    if (code === 'ORDER_CART_EMPTY') return errors.cartEmpty;
    if (code === 'ORDER_IDEMPOTENCY_IN_PROGRESS') return errors.idempotencyInFlight;
    if (code === 'SHIPPING_METHOD_INVALID') return errors.shippingMethodInvalid;
```

A code the page does not name falls to `errors.generic` for any `StorefrontError` and to `errors.networkUnavailable` for a failed connection, both in the active locale. Adding a code is one string per catalogue and one line here; [Add a string](../customize/recipes/storefront/add-a-string.md) shows the edit.

## 8. The proxied SEO files

`proxyTextSurface` in `apps/storefront/src/server/proxy-seo.ts` fetches one upstream path, sets the content type and cache header the route asks for, returns the body byte for byte, and answers `502` with a request id when the API does not answer `2xx`. Excerpt from `apps/storefront/src/server/proxy-seo.ts`:

```ts
  const body = await upstream.text();
  setResponseStatus(event, 200);
  setResponseHeader(event, 'Content-Type', opts.contentType);
  setResponseHeader(event, 'Cache-Control', opts.cacheControl);
  if (opts.forwardAcceptLanguage) {
    setResponseHeader(event, 'Vary', 'Accept-Language');
  }
  setResponseHeader(event, 'X-Request-Id', requestId);
  return body;
```

One Nitro route per file calls it: `apps/storefront/src/server/routes/sitemap_index.xml.ts`, `sitemap-products.xml.ts`, `sitemap-categories.xml.ts`, `sitemap-pages.xml.ts`, `robots.txt.ts`, `llms.txt.ts` and `llms-full.txt.ts`, all under `apps/storefront/src/server/routes/`. `sitemap.xml.ts` answers a `301` to `/sitemap_index.xml` and `llms_full.txt.ts` to the hyphen name. The two `llms` routes pass `forwardAcceptLanguage: true`; the sitemaps and `robots.txt` do not, because their bodies are the same in every locale. Excerpt from `apps/storefront/src/server/routes/llms.txt.ts`:

```ts
export default defineEventHandler(async (event) => {
  return proxyTextSurface(event, {
    upstreamPath: '/v1/llms.txt',
    contentType: 'text/plain; charset=utf-8',
    cacheControl: 'public, max-age=600, s-maxage=21600',
    forwardAcceptLanguage: true,
  });
});
```

## 9. JSON-LD, canonical and `hreflang`

`apps/storefront/src/lib/seo.ts` builds every head tag from the store config and the entity, and checks each JSON-LD object against a Zod schema before it is serialised. The `hreflang` set is derived once from the locale list, with the region for each locale from `apps/storefront/src/lib/locale-region.ts`. Excerpt from `apps/storefront/src/lib/seo.ts`:

```ts
export function hreflangSet(
  baseUrl: string,
  pathFor: (locale: Locale) => string,
  locales: SeoLocaleContext,
): { hreflang: string; href: string }[] {
  return [
    ...locales.supportedLocales.map((locale) => ({
      hreflang: regionFromLocale(locale, locales),
      href: joinUrl(baseUrl, pathFor(locale)),
    })),
    { hreflang: 'x-default', href: joinUrl(baseUrl, pathFor(locales.defaultLocale)) },
  ];
}
```

The product page in `apps/storefront/src/app/pages/[locale]/catalog/product/[slug].page.ts` calls the builder with `this.storeConfig.seoLocales()`, then writes the tags with `upsertCanonical` and `upsertHreflang`, which replace the existing `<link rel="canonical">` and every `<link rel="alternate" hreflang>` rather than appending, so a client-side navigation between two products leaves one set in the head. The home page, the category page, the search page and the CMS pages under the same directory do the same with their own builders. `serializeJsonLd` escapes `<` so a product description cannot close the script tag.

## 10. The revalidation route

`handleRevalidate` in `apps/storefront/src/server/routes/api/_internal/revalidate.post.ts` is the Nitro handler for `POST /api/_internal/revalidate`. It checks the secret in constant time, parses the body with a strict Zod schema, records the `eventId` in the dedup store and calls an `invalidate` hook for each path. The shipped build passes no hook: it renders every page per request and holds no HTML cache, so for it the route is the secret check, the dedup and the log, and the next request already carries the change. A storefront that caches renders wires its cache's purge into that hook. Excerpt from `apps/storefront/src/server/routes/api/_internal/revalidate.post.ts`:

```ts
const revalidateBodySchema = z
  .object({
    paths: z.array(z.string().min(1).max(2048)).min(1).max(64),
    reason: z.enum(REVALIDATE_REASONS),
    eventId: z.string().uuid(),
  })
  .strict();
```

and further down:

```ts
  if (await dedupStore.isDuplicate(eventId)) {
    log({ paths: paths.length, reason, eventId, deduped: true });
    setResponseStatus(event, 200);
    setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8');
    return { data: { invalidated: 0, eventId, deduped: true } };
  }

  await dedupStore.recordEvent(eventId, DEDUP_TTL_MS);
```

The store is `apps/storefront/src/server/lib/dedup-store.ts`: Redis with a twelve-hour `SET NX` when `REDIS_HOST` is set, in-memory otherwise, and a boot guard that refuses the in-memory one in production. The secret is `STOREFRONT_REVALIDATE_SECRET` on both sides; the engine's caller is `apps/api/src/modules/webhooks/revalidation.listener.ts`, which posts to `STOREFRONT_REVALIDATE_URL` with a fresh `eventId` per event and never blocks the write that triggered it. The engine sends four reasons (`product.write`, `category.write`, `cms.write`, `config.write`); the shipped schema's `REVALIDATE_REASONS` lists the first three, so a config write is answered `400 INVALID_BODY` by this build. Accept all four in yours.
