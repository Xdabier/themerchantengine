---
title: Revalidation
description: "The route a storefront exposes so the engine can tell it a page changed: the secret header, the body of paths and a reason, the events that fire it, the fast 200 it must answer, the dedup window, and what to invalidate in Next.js, Nuxt and SvelteKit."
primaryQuery: storefront revalidation webhook secret invalidate ssr cache paths ecommerce api
updated: 2026-09-09
schema: TechArticle
---

A storefront that caches rendered HTML, or the store config, serves stale pages after an operator edits a product, a category slug, a home section or a store setting. The engine closes that gap by calling one route on your storefront with the list of paths that changed. Exposing that route is the tenth obligation of the contract (see [the ten obligations](./index.md#the-ten-obligations)). The route is yours to implement; this page gives you the exact request the engine sends, the answer it expects, and what the shipped storefront does with it.

## When the engine calls you

The caller is `apps/api/src/modules/webhooks/revalidation.listener.ts`. It listens to five internal events and posts once per event:

- A product is created, updated, deleted or restored (`product.mutated`). Paths: the four sitemap paths (`/sitemap_index.xml`, `/sitemap-products.xml`, `/sitemap-categories.xml`, `/llms.txt`). Reason `product.write`.
- A product slug changes. Paths: the old and the new product URL under every enabled locale, plus the sitemap paths. Reason `product.write`.
- A category slug changes. Paths: the old and the new category URL under every locale, plus the sitemap paths. Reason `category.write`.
- A home section or any other storefront section is created, updated, deleted, reordered or toggled. Paths: the page under every locale (`/en/`, `/fr/` for the `home` slug; `/en/<pageSlug>`, `/fr/<pageSlug>` otherwise). Reason `cms.write`.
- A store setting, the locale set, or the currency roster changes (`store-config.updated`, emitted by `apps/api/src/modules/settings/settings.events.ts`). Home banners live in the `storefront` settings group, so a banner edit arrives this way too. Paths: the localised roots (`/en/`, `/fr/`) and `/llms.txt`. Reason `config.write`.

A CMS page edit (the `cms` module, `GET /v1/pages/{slug}`) emits none of these events, so a storefront that caches a CMS page must use a short TTL for it. A license verdict written at boot bypasses the event on purpose, so a restart never pokes your route.

The listener needs two environment variables on the engine, read at dispatch time:

- `STOREFRONT_REVALIDATE_URL`: the absolute URL of your route. Example: `https://shop.example/api/_internal/revalidate`.
- `STOREFRONT_REVALIDATE_SECRET`: a shared string of at least 32 bytes. The storefront holds the same value.

With either unset the engine logs at debug level and skips the call; nothing else changes. Both are listed in [the environment reference](../reference/environment-variables.md).

## The request

One `POST` to the URL above, with no query string:

```http
POST /api/_internal/revalidate HTTP/1.1
Host: shop.example
Content-Type: application/json
X-Revalidate-Secret: <STOREFRONT_REVALIDATE_SECRET>
X-Request-Id: 11111111-1111-4111-8111-111111111111

{"paths":["/fr/catalog/product/airpods-pro","/en/catalog/product/airpods-pro"],"reason":"product.write","eventId":"11111111-1111-4111-8111-111111111111"}
```

The body has exactly three fields:

- `paths`: one to sixty-four absolute paths on your origin, each up to 2048 characters. They are storefront paths, not API paths, and the engine builds them from the shipped storefront's URL scheme (`/{locale}/catalog/product/{slug}`, `/{locale}/catalog/{slug}`, `/{locale}/{pageSlug}`, `/{locale}/`). A storefront with a different URL scheme maps them; the slug is the last segment and the locale is the first.
- `reason`: `product.write`, `category.write`, `cms.write` or `config.write`.
- `eventId`: a UUID v4, new for every call, also sent as `X-Request-Id`. Deduplicate on it.

The secret rides in the `X-Revalidate-Secret` header and nowhere else. Compare it with a constant-time function.

The example above is the request the shipped route's test suite sends (`apps/storefront/src/server/__tests__/revalidate.post.spec.ts`), with the headers the engine adds. It is not captured from a running engine: the engine reads `STOREFRONT_REVALIDATE_URL` from its process environment at dispatch time, so a target cannot be pointed at a capture listener without restarting the API, and the engine this page was run against had no target configured. The listener code and the spec agree on every field.

Retries and timeouts: there are none. The listener awaits one `fetch`, logs a warning on any non-2xx and an error on a network failure, and returns. The write that triggered it has already committed and is never rolled back. A storefront that misses a call serves its stale page until the next event, or until its own TTL expires, so keep a TTL on everything you cache.

## The response

Answer `200` with a small JSON body and do the work after, not before. The engine does not read the body; it only checks `response.ok`. Answer inside a second: the listener runs asynchronously right after the write commits, holds no timeout of its own, and a slow answer keeps an engine worker busy for as long as you take.

The shipped storefront answers:

```json
{"data":{"invalidated":2,"eventId":"11111111-1111-4111-8111-111111111111","deduped":false}}
```

and, for an `eventId` it has already seen within twelve hours:

```json
{"data":{"invalidated":0,"eventId":"11111111-1111-4111-8111-111111111111","deduped":true}}
```

Both bodies are the shapes `apps/storefront/src/server/__tests__/revalidate.post.spec.ts` asserts. The dedup window is a Redis `SET NX` with a twelve-hour TTL in `apps/storefront/src/server/lib/dedup-store.ts` when `REDIS_HOST` is set, and an in-memory map otherwise; in production the store refuses to boot without Redis, because a captured `(secret, eventId)` pair could otherwise be replayed against another replica. Two things matter for your own implementation: the dedup key is the `eventId`, and a store that cannot be reached must fail open (treat the event as new and invalidate again), never closed.

## Error codes

The shipped route in `apps/storefront/src/server/routes/api/_internal/revalidate.post.ts` answers these; a storefront of your own should answer the same statuses so the engine's log stays readable:

- `UNAUTHORIZED`, 401: the header is missing, the value is wrong, or the storefront itself has no `STOREFRONT_REVALIDATE_SECRET` set. The body is `{"error":{"code":"UNAUTHORIZED","message":"Invalid or missing revalidate secret."}}` and never echoes the secret or the body.
- `INVALID_BODY`, 400: the body failed the schema. `details` lists each failing field as `{ "path": [...], "code": "..." }`. An empty `paths`, a non-UUID `eventId` or an unknown `reason` all land here.
- 500 with `statusMessage: "Revalidation failed."` and no body detail: an unexpected throw. The engine logs the status and moves on.

The engine treats every non-2xx the same way: one warning line with the status, the reason, the `eventId` and the path count, then nothing. There is no error code on the engine side for a failed revalidation, and no admin screen shows it; read the API log.

One mismatch to know about: the shipped route's `reason` allowlist is `product.write`, `category.write` and `cms.write`. The engine also sends `config.write` after a settings change, and the shipped route answers that call with `400 INVALID_BODY`. A storefront you build should accept all four reasons.

## Every locale

Every path the engine names is already localised: a slug change yields `/en/catalog/product/{slug}` and `/fr/catalog/product/{slug}` (one entry per locale the store has enabled, read from the store config at dispatch time, so a locale enabled by the very setting write that fired the event is included). Your route therefore invalidates each path as given and does not need to fan out by locale itself. The one exception is `/llms.txt`, which the shipped storefront serves without a locale prefix.

`Accept-Language` plays no part: the request is server to server and carries no locale. Nothing in the request or the response is translated.

## Framework notes

- Next.js: expose a route handler at the path you configure, check the header, then call `revalidatePath(path)` for each entry (or `revalidateTag('product:' + slug)` if you tag your fetches). Both are synchronous marks, so the handler returns quickly by nature.
- Nuxt: a server route under `server/api/`; invalidate with `useStorage('cache').removeItem(...)` for the `cachedEventHandler` and `defineCachedFunction` keys of each path, or purge the CDN in front of Nitro.
- SvelteKit: the adapter decides. On Vercel use ISR with a `bypassToken` and purge by path; on a Node adapter you own the cache, so drop the keys you built from `url.pathname` and the locale.
- On every framework: also drop the sixty-second cache of `GET /v1/store/config` that [the config page](./01-config-locale-money.md#the-sixty-second-cache) tells you to keep, on a `config.write` reason at least. The shipped storefront's `apps/storefront/src/server/store-config.ts` exports `resetStoreConfigCache()` for that purpose, though its route does not yet call it.
- Answer first, work after: enqueue the invalidation and return `200`, or run it synchronously only when it is a cheap in-process mark.

The long form, with the cookie forwarding and the idempotency-key notes that the other flow pages share, is on [the framework notes page](./framework-notes.md#the-revalidation-route).

## What the shipped storefront does

The Analog.js storefront's route validates the secret, validates the body, records the `eventId`, logs `{ paths, reason, eventId, deduped }`, and answers. Its handler accepts an `invalidate(path)` function as a dependency for tests, and the production handler passes none, because the shipped storefront renders every page on request and holds no HTML cache to drop. Its only cache is the sixty-second store config, which the route does not touch either, so a settings change shows up on the shipped storefront within a minute regardless of this call. If you add an HTML cache to a storefront of your own, this route is where you drop it.
