---
title: Framework notes
description: "What changes in Next.js, Nuxt 3 and SvelteKit against the framework-neutral fetch the flow pages show: cookie forwarding at SSR, the idempotency key on a retried action, 304 and the fetch caches, the base URL, the SEO proxy routes and the revalidation route."
primaryQuery: nextjs nuxt sveltekit headless storefront cookies ssr idempotency revalidate
updated: 2026-09-09
schema: TechArticle
---

The flow pages show every request as a plain `fetch` that runs the same in Node 22 and in a browser. That code does not change under a framework. What changes is the six things a framework wraps: how a server render reads the visitor's cookies and writes new ones, where a retried form keeps its idempotency key, what the framework's own fetch cache does to an authenticated response, where the base URL lives, how a route streams a file from the API, and how a cached page is dropped when the engine says it changed. Each is one section below, with a snippet for Next.js (App Router), Nuxt 3 and SvelteKit. The snippets are written from each framework's documented APIs as of 2026 and are illustrative: this repository does not build them, and the shipped storefront is Analog.js (see [Reference implementation](./reference-implementation.md)). Each flow page carries the short form of these notes under its "Framework notes" heading.

## Cookies at SSR

Two cookies identify a visitor (obligation 3 of [the contract](./index.md#the-ten-obligations)): the Better Auth session cookie and the `HttpOnly` cart cookie `sessionId`. A browser sends both with `credentials: 'include'`. A server render has no cookie jar of its own, so it copies the incoming `Cookie` header onto the API call and copies every `Set-Cookie` the API answers with onto its own response. Skip the second half and the cart cookie the API minted during the render never reaches the browser, so the next request starts a new cart.

### Next.js

`cookies()` and `headers()` from `next/headers` read the incoming request in a Server Component, a Route Handler or a Server Action. Writing a cookie is allowed in a Server Action or a Route Handler, not during a Server Component render, so a page that only reads the cart can forward the header while the write to the cart happens in an action:

```ts
import { cookies } from 'next/headers';

export async function apiFetch(path: string, init: RequestInit = {}) {
  const jar = await cookies();
  const cookie = jar.getAll().map((c) => `${c.name}=${c.value}`).join('; ');
  return fetch(`${process.env.API_URL}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { ...init.headers, Cookie: cookie, 'Accept-Language': locale },
  });
}
```

To relay a `Set-Cookie`, read `response.headers.getSetCookie()` from the API answer and, in the action, call `jar.set(name, value, { httpOnly: true, path: '/', sameSite: 'strict', secure: true })` per cookie, or in a Route Handler append each raw value with `headers.append('Set-Cookie', value)` on the `Response` you return.

### Nuxt 3

`useRequestHeaders(['cookie'])` returns the incoming header during SSR and an empty object in the browser, which is what you want: the browser sends its own cookies. `appendResponseHeader` from `h3` on `useRequestEvent()` relays the API's cookies:

```ts
import { appendResponseHeader } from 'h3';

const event = useRequestEvent();
const { data } = await useFetch(`/v1/cart`, {
  baseURL: useRuntimeConfig().public.apiBase,
  headers: { ...useRequestHeaders(['cookie']), 'Accept-Language': locale.value },
  credentials: 'include',
  onResponse({ response }) {
    if (!event) return;
    for (const c of response.headers.getSetCookie()) appendResponseHeader(event, 'set-cookie', c);
  },
});
```

`appendResponseHeader` rather than `setResponseHeader`, because a render can call the API twice and both cookies must survive.

### SvelteKit

In a `+page.server.ts` `load` or a form action, `event.request.headers.get('cookie')` is the incoming header and `event.cookies.set` writes to the response. `event.fetch` only forwards cookies to the app's own origin, so an API on another host needs the header copied by hand:

```ts
export const load = async ({ request, cookies, fetch }) => {
  const res = await fetch(`${env.API_URL}/v1/cart`, {
    headers: { Cookie: request.headers.get('cookie') ?? '', 'Accept-Language': locale },
  });
  for (const raw of res.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(';');
    const [name, value] = pair.split('=');
    cookies.set(name, value, { path: '/', httpOnly: true, sameSite: 'strict' });
  }
  return { cart: (await res.json()).data };
};
```

The `handleFetch` hook in `src/hooks.server.ts` is the place to do this once for every server-side `fetch` to the API host instead of in each `load`.

## The idempotency key on a retried action

`POST /v1/orders` needs `X-Idempotency-Key` as a UUID v4, and a retry must carry the same key (obligation 6, [05 Checkout and orders](./05-checkout-and-orders.md)). The trap in every framework is the same: a key generated inside the action is a new key on every submit, and a double click places two orders. Generate it once when the checkout page renders, keep it where the resubmit can read it, and reuse it until the order is placed.

- Next.js: generate the key in the Server Component that renders the checkout (`crypto.randomUUID()`), put it in a hidden `<input name="idempotencyKey">` or in the state you pass to `useActionState`, and read it in the Server Action. A retry through the same form sends the same value. Do not generate it in the action.
- Nuxt 3: hold it in `useState('checkoutKey', () => crypto.randomUUID())`, which is created once on the server, serialised into the payload and shared with the browser, so the client-side resubmit reuses it. A server route under `server/api/` that places the order reads it from the body and forwards it as the header.
- SvelteKit: create it in the `+page.server.ts` `load` and return it as page data; the form carries it as a hidden input, and the form action (`export const actions`) forwards it as the header. With `use:enhance` a failed submit keeps the form and the input, so the retry sends the same key. Alternatively store it in a short-lived cookie set in `load`.

In every case, a `409 IDEMPOTENCY_KEY_CONFLICT` means the body changed under the same key (the cart moved); mint a new key only when the cart itself changed, as the shipped storefront does per cart snapshot.

## `304` and the framework's fetch cache

The API sends no `ETag` and `Cache-Control: no-store` on every authenticated route, so it never answers `304` itself; the header dumps on [01 Config, locale and money](./01-config-locale-money.md) show it and [Conventions](../customize/conventions.md#browser-caching-and-304) explains why. A `304` can still come from a CDN in front of the storefront or from a cache the framework adds around `fetch`. Two rules cover it (obligation 4): return from a `304` before the error branch, and never let a framework cache hold a response that depends on a cookie.

- Next.js extends `fetch` with a Data Cache. In the App Router since Next.js 15 a `fetch` is uncached by default, but a `fetch` inside a statically rendered route can still be cached at build time, and `cache: 'force-cache'` opts a call in. Every call that carries a `Cookie` header takes `cache: 'no-store'`, and a page that reads a cookie is dynamic by construction. Reserve `next: { revalidate: 60 }` for the store config and the public catalogue reads.
- Nuxt 3: `useFetch` deduplicates by key and caches the payload for hydration; `$fetch` (ofetch) adds no HTTP cache. The server-side `cachedEventHandler` and `defineCachedFunction` do cache, and they must never wrap a route that reads a cookie, because the cached copy is served to the next visitor. Keep them for the store config and the SEO proxies.
- SvelteKit: a `fetch` made in a universal `load` (`+page.ts`) has its response serialised into the HTML for hydration, so a response that depends on a cookie belongs in `+page.server.ts`, whose result is not inlined as a raw response. SvelteKit adds no HTTP cache; `setHeaders({ 'cache-control': ... })` in `load` sets the page's own header, and it is only for pages that render the same for everyone.

Whichever wrapper you use, the branch that maps a non-2xx status to an error must let `304` through as "unchanged" and return the value you already hold.

## Where the base URL lives

The server calls the API on its internal address and the browser on the public one, and the two are different values on an installed store. Keep both out of the code.

- Next.js: `API_URL` for the server (read from `process.env` in Server Components, actions and Route Handlers) and `NEXT_PUBLIC_API_URL` for the browser bundle, inlined at build time.
- Nuxt 3: `runtimeConfig.apiBase` (set from `NUXT_API_BASE`, server only) and `runtimeConfig.public.apiBase` (set from `NUXT_PUBLIC_API_BASE`, both sides), read through `useRuntimeConfig()` at request time, so an image built once runs on any host.
- SvelteKit: `$env/dynamic/private` for `API_URL` on the server and `$env/dynamic/public` for `PUBLIC_API_URL`; the `PUBLIC_` prefix is what allows a variable into the client bundle.

The shipped storefront reads `STOREFRONT_API_URL` on the server and calls the same origin from the browser, with the edge routing `/api` to the engine.

## Proxy routes for the SEO files

`sitemap_index.xml`, the three sitemaps, `robots.txt`, `llms.txt` and `llms-full.txt` are served at the storefront's root by streaming the API's body with the API's content type (obligation 8, [08 SEO and GEO](./08-seo-and-geo.md)). Forward `Accept-Language` for the two `llms` files and set `Vary: Accept-Language` on them. One route per file; the handler is the same each time.

### Next.js

A Route Handler at `app/sitemap_index.xml/route.ts`:

```ts
export const dynamic = 'force-dynamic';

export async function GET() {
  const upstream = await fetch(`${process.env.API_URL}/v1/sitemap_index.xml`);
  return new Response(upstream.body, {
    status: upstream.ok ? 200 : 502,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  });
}
```

### Nuxt 3

A server route at `server/routes/sitemap_index.xml.ts`:

```ts
export default defineEventHandler(async (event) => {
  const upstream = await fetch(`${useRuntimeConfig().apiBase}/v1/sitemap_index.xml`);
  setResponseStatus(event, upstream.ok ? 200 : 502);
  setResponseHeader(event, 'Content-Type', upstream.headers.get('content-type') ?? 'application/xml');
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300, s-maxage=3600');
  return upstream.text();
});
```

### SvelteKit

A server endpoint at `src/routes/sitemap_index.xml/+server.ts`:

```ts
import { env } from '$env/dynamic/private';

export async function GET() {
  const upstream = await fetch(`${env.API_URL}/v1/sitemap_index.xml`);
  return new Response(upstream.body, {
    status: upstream.ok ? 200 : 502,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  });
}
```

For `llms.txt` and `llms-full.txt`, add `headers: { 'Accept-Language': request.headers.get('accept-language') ?? defaultLocale }` to the upstream call and `Vary: Accept-Language` to the response.

## The revalidation route

The engine posts `{ paths, reason, eventId }` with `X-Revalidate-Secret` to the URL in `STOREFRONT_REVALIDATE_URL` when a product, a category or a home section changes, and on every store-config write (obligation 10, [10 Revalidation](./10-revalidation.md)). The route compares the secret in constant time, answers `401` on a mismatch, records `eventId` so a replay is a no-op, and drops the cached render of each path. What "drop" means depends on the framework's cache.

- Next.js: a Route Handler at `app/api/_internal/revalidate/route.ts` reads the body and calls `revalidatePath(path)` for each entry from `next/cache`; if the catalogue reads are tagged (`fetch(url, { next: { tags: ['product:' + slug] } })`), `revalidateTag(tag)` is finer and drops every page that used the product. The next request re-renders. With `output: 'export'` there is nothing to revalidate; use ISR or dynamic rendering.
- Nuxt 3: a server route at `server/api/_internal/revalidate.post.ts`. Pages cached with `cachedEventHandler` or `routeRules: { '/**': { swr: 3600 } }` live in the Nitro cache storage, so invalidation is `useStorage('cache').removeItem(key)` for each key the handler's `getKey` produced, or `clear` on the `nitro:handlers` base when the paths are broad. Give the handler a `getKey` that is the path, so the body's `paths` map to keys without a lookup.
- SvelteKit: there is no built-in page cache, so the route at `src/routes/api/_internal/revalidate/+server.ts` calls the adapter's purge: on Vercel, pages rendered with `export const config = { isr: { expiration: 60, bypassToken } }` are refreshed by requesting the path with the `x-prerender-revalidate` header set to the token; on other hosts, purge the CDN by path with its API. A store with no cache in front can answer `200` with `invalidated: 0` and rely on dynamic rendering.

Keep the dedup store shared when the storefront runs more than one instance (Redis or the platform's KV), and never log the secret. The shipped handler in `apps/storefront/src/server/routes/api/_internal/revalidate.post.ts` is the shape to copy: `401` before the body is read, a strict schema on the body, `{ data: { invalidated, eventId, deduped } }` on success.
