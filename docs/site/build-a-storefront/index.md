---
title: The storefront contract
description: "What any storefront owes the engine: the ten obligations, why each exists, the flow page that shows it as requests, and the file in the shipped storefront that proves it."
primaryQuery: headless ecommerce storefront contract api obligations
updated: 2026-09-09
schema: TechArticle
---

A storefront is any HTTP client that meets ten obligations toward the engine. It can be a Next.js, Nuxt or SvelteKit app, a static site with islands, a native app or a script. The shipped Analog.js storefront under `apps/storefront/` is one such client and the reference: each obligation below names the file in it that meets the rule, so you can read a working answer instead of guessing. The flow pages `00` to `10` show each obligation as requests you run against a local engine, and the [conformance checklist](./conformance-checklist.md) is the same list as something you tick.

The rules the API enforces on its own side (envelopes, locale resolution, permissions, idempotency keys, caching, session bootstrap) are on [Conventions](../customize/conventions.md). This page does not repeat them. It says what the client does about each.

## The ten obligations

### 1. Read the store config first and render from it

Call `GET /v1/store/config` before anything else and take the store's identity, brand palette, font kit, locale set, writing direction, money format and domains from the answer. The body has five keys: `identity`, `brand`, `localization` (`supportedLocales`, `defaultLocale`, `rtlLocales`, `timezone`), `money` and `domains`. A storefront that hard-codes a currency, a locale pair or a colour fits one store and breaks on the next.

Shown on [01 Config, locale and money](./01-config-locale-money.md); the field list is on [Store config](../reference/store-config.md). Proven by `apps/storefront/src/server/store-config.ts` (`readStoreConfig`, a per-process cache the root locale redirect reads), `apps/storefront/src/app/services/store-config.service.ts` (the same config carried from the server pass to the browser through `TransferState`), `apps/storefront/src/app/services/brand-tokens.service.ts` (the `:root` custom properties written from `brand.generatedPalette` and `brand.fontKit`), `apps/storefront/src/app/locale.service.ts` (`dir` on `<html>` from `localization.rtlLocales`) and `apps/storefront/src/lib/money.ts` (`formatMoney` from the `money` block). The shipped storefront also reads the narrower `GET /v1/storefront/config` through `libs/storefront-services/src/lib/storefront-config/store-config.service.ts` for the settings only a storefront needs; see [storefront](../reference/storefront-api/storefront.md).

### 2. Send `Accept-Language` on every call

Every translatable field is resolved to one string per request from the locale header, with the store default as the fallback and the `default` key last. No header means the `default` key on every field, whatever the visitor chose. The API's rungs are on [Conventions](../customize/conventions.md#translatable-text-and-locale-resolution).

Send `X-Locale` too from a browser page. `Accept-Language` is a forbidden header name in the Fetch standard; Chromium lets a page set it and WebKit does not, so on Safari the line is dropped and the phone's language reaches the API. The interceptor reads `X-Locale` first.

Shown on [01](./01-config-locale-money.md) and [03 Catalog and search](./03-catalog-and-search.md). Proven by `libs/storefront-services/src/lib/shared/browser-api-client.ts` (`resolveBrowserLocale` reads `<html lang>` once and sets both headers on every request) and `apps/storefront/src/server/api-client.ts` (`Accept-Language: ctx.locale`, where the locale comes from the matched route parameter through `apps/storefront/src/server/server-api-client-factory.ts`, never from the visitor's browser header).

### 3. Carry the session cookie and the cart cookie

Two cookies identify a visitor. Better Auth sets its session cookie (prefix `better-auth`) on sign-in; the cart module sets an `HttpOnly` cookie named `sessionId` on the first write to an anonymous cart. Neither is readable from JavaScript, so the storefront never handles a token. In a browser every request goes out with `credentials: 'include'`. On a server render the storefront forwards the incoming `Cookie` header to the API byte for byte and relays every `Set-Cookie` the API answers with back to the visitor, because Better Auth rotates its cookie and the cart mints its own.

Shown on [02 Auth and session](./02-auth-and-session.md) and [04 Cart](./04-cart.md). Proven by `libs/storefront-services/src/lib/shared/browser-api-client.ts` (`credentials: 'include'`), `libs/storefront-services/src/lib/auth/auth-client.ts` (the Better Auth client, same default), `apps/storefront/src/server/api-client.ts` (`headers.set('Cookie', ctx.cookieHeader)` and `pipeSetCookies`) and `apps/storefront/src/server/server-api-client-factory.ts` (`makeSetCookieSink`, which appends rather than overwrites so two `Set-Cookie` values from one render both survive). The cookie name is the constant `SESSION_COOKIE_NAME` in `apps/api/src/modules/cart/cart.constants.ts`.

### 4. Treat `304` as success and never cache an authenticated response

The API emits no `ETag` and answers `Cache-Control: no-store` on everything except a few public, read-only routes (`GET /v1/store/config` carries `public, max-age=60` with a `Vary` on the locale headers; the sitemaps, `robots.txt` and the `llms.txt` files carry an hour). So the API itself never answers `304`. One can still arrive from a cache in front of the storefront, or from a fetch layer the framework adds, and a client that routes it through its error path shows an error for a success. The client returns from `304` before its `!response.ok` branch. And nothing that depends on a cookie is ever stored in a shared cache, because the cached copy would be served to the next visitor.

Shown on [01](./01-config-locale-money.md), where the header dumps are pasted; the rule is on [Conventions](../customize/conventions.md#browser-caching-and-304). Proven by the `if (response.status === 304) return undefined` guard in both `libs/storefront-services/src/lib/shared/browser-api-client.ts` and `apps/storefront/src/server/api-client.ts`, and by the tripwire in `mapHttpErrorToStorefrontError` (`libs/storefront-types/src/lib/shared/errors.ts`), which logs loudly if a `304` ever reaches the error mapper.

### 5. Bootstrap the session atomically

On the first browser mount, resolve the session with one call to `GET /v1/auth/get-session` and commit the user in one step or not at all. A `null` answer covers logged-out and a transient `429` or `5xx` alike, and it leaves the state as it was: nothing is cleared, nobody is logged out by a rate-limit blip. Mark the boot settled in a `finally` so a page that needs the outcome waits on it instead of polling a half-set flag. Server renders never call it; a route that also renders anonymously treats a `401` as "no user" and lets the browser resolve the real session after hydration.

Shown on [02](./02-auth-and-session.md); the rule is on [Conventions](../customize/conventions.md#session-bootstrap). Proven by `boot()` in `apps/storefront/src/app/layout/layout-shell.component.ts`, `setSession` and `markBooted` in `apps/storefront/src/app/services/auth-state.service.ts`, and `getSession` in `libs/storefront-services/src/lib/auth/auth.service.ts`, which returns `null` for every outcome that is not a parsed customer.

### 6. Send `X-Idempotency-Key` on order creation and repeat it on a retry

`POST /v1/orders` refuses a request without the header (`IDEMPOTENCY_KEY_REQUIRED`) and a value that is not a UUID v4 (`IDEMPOTENCY_KEY_MALFORMED`). A second request with the same key and the same body returns the stored order without running the handler again; the same key with a different body is a `409`; the same key from another caller is a `403`. So a storefront generates the key once per checkout attempt and keeps it across a failed submit, a lost connection and a page re-mount, and the customer can press the button twice without paying twice.

Shown on [05 Checkout and orders](./05-checkout-and-orders.md); the state machine is on [Conventions](../customize/conventions.md#idempotency-keys). Proven by `create(input, idempotencyKey)` in `libs/storefront-services/src/lib/orders/orders.service.ts`, which validates the key as a UUID before the call, and by `apps/storefront/src/app/pages/[locale]/checkout/index.page.ts`, where the `idempotencyKey` signal is set once with `crypto.randomUUID()` when the cart loads and never reset on a failed `placeOrder`.

### 7. Surface every error code in every locale of the store

The error envelope is `{ error: { code, message, details? } }` and `message` is English whatever `Accept-Language` says. The code is the contract. A storefront keeps its own catalogue of one string per code per locale, looks the code up, and shows the raw message to nobody. A code it does not know falls to a generic string in the right locale, never to an English sentence on a French page.

Every flow page lists its codes under "Error codes", with the full catalogue on [Error codes](../reference/error-codes.md); the envelope is on [Conventions](../customize/conventions.md#response-and-error-envelopes). Proven by the per-locale catalogues `apps/storefront/src/i18n/en.ts`, `apps/storefront/src/i18n/fr.ts` and `apps/storefront/src/i18n/ar.ts`, all typed by `apps/storefront/src/i18n/types.ts` so a string missing in one locale is a compile error, by `placeOrderErrorMessageFor` in `apps/storefront/src/app/pages/[locale]/checkout/index.page.ts`, which switches on `code`, and by `libs/storefront-types/src/lib/shared/errors.ts`, whose typed errors carry `code` from the envelope.

### 8. Proxy the SEO and GEO files from the API

The API writes `sitemap_index.xml`, `sitemap-products.xml`, `sitemap-categories.xml`, `sitemap-pages.xml`, `robots.txt`, `llms.txt` and `llms-full.txt`, and `sitemap.xml` answers a `301` to the index. Crawlers read them at the storefront's root, and the `Sitemap:` line in `robots.txt` names the storefront host, not the API. So the storefront serves each file at its root by streaming the API's body with the same content type, and forwards `Accept-Language` for the two `llms` files, which are written per locale and answer `Vary: Accept-Language`.

Shown on [08 SEO and GEO](./08-seo-and-geo.md); the routes are on [seo](../reference/storefront-api/seo.md). Proven by `proxyTextSurface` in `apps/storefront/src/server/proxy-seo.ts` and one Nitro route per file under `apps/storefront/src/server/routes/` (`sitemap_index.xml.ts`, `robots.txt.ts`, `llms.txt.ts`, `llms-full.txt.ts` and the rest); `libs/storefront-services/src/lib/seo/seo.service.ts` reaches the same routes from inside Angular.

### 9. Emit the JSON-LD, canonical and `hreflang` the SEO page names

Every page carries one canonical URL, one `<link rel="alternate" hreflang>` per supported locale plus `x-default` pointing at the default locale, and the JSON-LD for what it shows: `Organization` and `WebSite` on the home page, `BreadcrumbList` and `Product` on a product page, `ItemList` on a listing. The values come from the store config (`identity`, `domains`, `localization`) and from the entity, so nothing is typed twice.

Shown on [08](./08-seo-and-geo.md), which says which field feeds which tag. Proven by `apps/storefront/src/lib/seo.ts` (`hreflangSet`, `organizationJsonLd`, `websiteJsonLd`, `breadcrumbListJsonLd`, `serializeJsonLd`, each output checked by a Zod schema), `apps/storefront/src/lib/locale-region.ts` (the locale-to-region map the `hreflang` values come from) and `upsertCanonical` and `upsertHreflang` in `apps/storefront/src/app/pages/[locale]/catalog/product/[slug].page.ts`.

### 10. Expose the revalidation route the engine calls when content changes

When a product, a category, a CMS page or the store config is written, the engine posts `{ paths, reason, eventId }` to the URL in its `STOREFRONT_REVALIDATE_URL` variable with the shared secret in `X-Revalidate-Secret`; `reason` is one of `product.write`, `category.write`, `cms.write` and `config.write`. The storefront compares the secret in constant time, refuses a missing or wrong one with a `401`, records `eventId` so a replayed event answers `deduped: true` instead of acting twice, and drops whatever it cached for each path. The path is the storefront's choice; the shipped one answers at `/api/_internal/revalidate`, checks the secret and dedups, and holds no HTML cache to drop, so the dropping is yours to write (see [10 Revalidation](./10-revalidation.md)). The engine treats a missing URL as opt-out and never blocks the write on the call.

Shown on [10 Revalidation](./10-revalidation.md). Proven by `handleRevalidate` in `apps/storefront/src/server/routes/api/_internal/revalidate.post.ts` and the dedup store in `apps/storefront/src/server/lib/dedup-store.ts`; the engine side is `apps/api/src/modules/webhooks/revalidation.listener.ts`.

## How to use this track

Run the engine ([00](./00-run-the-engine.md)), then follow the pages `00` to `10` in order: each one is the requests of one obligation with the responses pasted from a real run, under both locales of the demo store. Tick the [conformance checklist](./conformance-checklist.md) as you go. When a step is unclear, read the [reference implementation](./reference-implementation.md) for the file that does it in the shipped storefront, and the [framework notes](./framework-notes.md) for what changes in Next.js, Nuxt and SvelteKit.
