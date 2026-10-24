---
title: Content and sections
description: "GET /v1/pages and GET /v1/pages/{slug} for the operator's rich-text pages, GET /v1/storefront/sections/{pageSlug} for the home page blocks with every section type and its fields, the deprecated home-banners route, and what a storefront renders as HTML, what it must escape, and how it stays correct when a type or a field is missing."
primaryQuery: cms pages home sections api storefront render rich text json
updated: 2026-09-09
schema: TechArticle
---

Two routes give a storefront the content an operator writes in the admin rather than in code: `GET /v1/pages` for the pages (about, delivery, terms, any slug the operator adds) and `GET /v1/storefront/sections/{pageSlug}` for the ordered blocks of a landing page such as the home page. Both are public, both resolve every `Translatable` field to the locale in `Accept-Language`, and both are the reason a storefront can be rebuilt by an operator without a deploy. Rendering them serves obligation two of [the contract](./index.md#the-ten-obligations) (send `Accept-Language` on every call) and obligation ten (expose a revalidation route, because these two payloads are what changes when the operator saves). This page runs each route against the `demo` fixture under both locales, lists every section type with the fields a renderer needs, and states the defensive rules the shipped storefront applies when a row carries a type it does not know or a field it expected.

The store config itself (`GET /v1/store/config`, and the narrower `GET /v1/storefront/config` with the logo, social links and pixels) is covered on [Config, locale and money](./01-config-locale-money.md#get-v1storefrontconfig); this page only links it.

## The request

Four routes, all `GET`, all public, none needs a cookie. Full parameter lists: [Pages](../reference/storefront-api/pages.md) and [Storefront](../reference/storefront-api/storefront.md).

- `GET /v1/pages`: every published page, ordered by `sortOrder`. No pagination and no `meta`; the array is the whole list.
- `GET /v1/pages/{slug}`: one published page. Slugs are stored with a leading slash (`/about`) and requested without it (`/v1/pages/about`); the API adds the slash back. A slug may hold more than one segment (`/v1/pages/help/returns` reads the page `/help/returns`).
- `GET /v1/storefront/sections/{pageSlug}`: the visible sections of a page, ordered by `sortOrder`. `pageSlug` is lowercase kebab, 1 to 64 characters, no leading or trailing hyphen; anything else is a `400`. The shipped storefront reads `home`.
- `GET /v1/storefront/home-banners`: deprecated, answers `null` in every field on a current store. Read the sections route instead; it is shown below only so you recognise it.

Headers that matter: `Accept-Language` picks the locale every `Translatable` field is collapsed to (rules on [Conventions](../customize/conventions.md#translatable-text-and-locale-resolution)). Every one of these routes answers `Cache-Control: no-store` (header dumps below), so a browser never caches them; caching is your storefront's job, see "Framework notes".

```bash
curl -s -H "Accept-Language: en" https://api.shop.example/api/v1/pages
curl -s -H "Accept-Language: fr" https://api.shop.example/api/v1/pages/about
curl -s -H "Accept-Language: en" https://api.shop.example/api/v1/storefront/sections/home
```

The same in `fetch`, for Node 22 and for a browser (the routes need no cookie, but a browser storefront sends `credentials: 'include'` on every call so the cart and session cookies ride along everywhere):

```js
const API = 'https://api.shop.example/api/v1';
const inBrowser = typeof window !== 'undefined';

async function getJson(path, locale) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Accept-Language': locale },
    ...(inBrowser ? { credentials: 'include' } : {}),
  });
  const body = await res.json();
  if (!res.ok) throw body.error; // { code, message, details? }
  return body.data;
}

const pages = await getJson('/pages', 'en');
const page = await getJson('/pages/about', 'en');
const sections = await getJson('/storefront/sections/home', 'en');
```

## The response

### The pages list

`GET /v1/pages` under `Accept-Language: en`, trimmed to its first two entries (the fixture holds eight):

```http
HTTP/1.1 200 OK
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
```

```json
{"data":[{"id":"cmtbxa9ji000xmoqskz8bbwgy","title":"Page QA 2026","slug":"/qa-page-2026","content":"Intro de la page QA.<ul><li>Point un</li></ul><h2><ul><li>Point deux</li></ul></h2>","type":"STATIC","isPublished":true,"metaTitle":null,"metaDescription":null,"sortOrder":0,"showInNavigation":true,"template":null,"createdAt":"2026-08-27T19:35:32.046Z","updatedAt":"2026-08-27T19:35:32.046Z","deletedAt":null},{"id":"cmtal4qp1007t5gqsnk4zfwfb","title":"About Us","slug":"/about","content":"Learn more about our store and mission.","type":"STATIC","isPublished":true,"metaTitle":null,"metaDescription":null,"sortOrder":0,"showInNavigation":true,"template":null,"createdAt":"2026-08-26T21:07:32.773Z","updatedAt":"2026-08-30T16:11:11.187Z","deletedAt":null}]}
```

Fields a storefront renders:

- `title`: plain text, already resolved to the request locale. Escape it; never treat it as HTML.
- `slug`: the page's key, with its leading slash. Your route is `/{locale}/pages{slug}` (the shipped storefront serves `/en/pages/faq`); the sitemap the API builds for you uses exactly that shape, see [SEO and GEO](./08-seo-and-geo.md).
- `content`: sanitised HTML, see "What you may render as HTML" below.
- `type`: `STATIC`, `POLICY` or `LANDING`. The shipped storefront renders the three the same way; `POLICY` is what an operator files a legal text under.
- `showInNavigation`: `true` when the operator wants the page in the footer or a menu. The list is the source of your footer links; do not hard-code them.
- `metaTitle` and `metaDescription`: `null` unless the operator filled them. When `null`, the shipped storefront titles the tab with `title` and builds the description from `content` with the tags stripped and cut at 200 characters.
- `sortOrder`: the order the operator chose; the list already comes sorted by it.

`isPublished` is always `true` on this route (unpublished pages are not listed), `template` is reserved and `null`, `deletedAt` is always `null`.

### One page

`GET /v1/pages/l5-content-demo` under `Accept-Language: en`. This page was created for the run through the admin API with a body that contained a `<script>` element, an `<img onerror>` and a paragraph with `style` and `onclick` attributes, so the response shows what survives the server-side sanitiser:

```json
{"data":{"id":"cmtuazors001p9sqsg491nb23","title":"Delivery and returns","slug":"/l5-content-demo","content":"<h2>Delivery</h2><p>Orders ship within <strong>two working days</strong>.</p><ul><li>Tracking is emailed on dispatch.</li></ul><p><a href=\"/en/pages/contact\">Contact us</a> with any question.</p><p>Styled</p>","type":"STATIC","isPublished":true,"metaTitle":null,"metaDescription":null,"sortOrder":50,"showInNavigation":false,"template":null,"createdAt":"2026-09-09T16:19:04.360Z","updatedAt":"2026-09-09T16:19:04.360Z","deletedAt":null}}
```

The `<script>` and the `<img>` are gone, the paragraph kept its text and lost both attributes.

### What you may render as HTML

`content` is sanitised when the operator saves it, by `libs/shared/common/src/utils/sanitize-rich-text.ts`, down to this allowlist: `p`, `br`, `strong`, `em`, `a` (with `href` and `title` only), `ul`, `ol`, `li`, `h1` to `h4`. Link schemes are limited to `https`, `http` and `mailto`. Every other tag is dropped with its text kept, every other attribute is dropped, and a block nested inside a paragraph or a heading is hoisted out so the stored markup is well formed. The editor's `<b>`, `<i>` and `<div>` are rewritten to `strong`, `em` and `p` before the allowlist runs.

So a storefront may put `content` straight into the page as HTML (`innerHTML`, `dangerouslySetInnerHTML`, `v-html`, `{@html}`), which is what the shipped storefront does in `apps/storefront/src/app/pages/[locale]/pages/[slug].page.ts`. Two things you must not do:

- Do not render any other field as HTML. `title`, `metaTitle` and `metaDescription` are plain text and are not sanitised for a markup context; escape them, and strip tags from `content` before you put it in a `<meta>` attribute or in JSON-LD (the shipped storefront uses `stripHtml` from `apps/storefront/src/lib/seo.ts`).
- Do not extend the trust to HTML from anywhere else. The sanitiser runs on the API's write path, so only `content` read from `GET /v1/pages` carries that guarantee. A description you concatenate, a string from a query parameter or a value from your own CMS layer needs its own sanitiser before it shares an `innerHTML` with this one. Do not build the page inside a `<script>`, a `<style>` or an attribute value either; the allowlist is safe for element content, not for those contexts.

Because `<img>` is not on the allowlist, a page carries no inline images; give the page a heading style for `h2` to `h4` and a list style, and the operator's text renders as they wrote it.

### The sections of a page

`GET /v1/storefront/sections/l5-content` under `Accept-Language: en`. The page slug `l5-content` was configured for the run with one section of each type, in the order shown, so every shape appears once:

```http
HTTP/1.1 200 OK
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
```

```json
{"data":[{"id":"cmtub0tpw002a9sqsoe0yq5ca","pageSlug":"l5-content","type":"HERO","title":"Home","config":{"cta":"Browse the catalogue","body":"Delivered in 48h.","assetId":"6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f","ctaHref":"/en/catalog","eyebrow":"New season","headline":"Everything for the studio","imageAlt":"A workbench"},"sortOrder":0,"isVisible":true,"visibleFrom":null,"visibleUntil":null,"createdAt":"2026-09-09T16:19:57.429Z","updatedAt":"2026-09-09T16:19:57.429Z","deletedAt":null},{"id":"cmtub6740003n9sqsxodbypw8","pageSlug":"l5-content","type":"CATEGORY_SHOWCASE","title":"Shop by category","config":{"heading":"Shop by category","categoryIds":["cmtub348d0000wcqs7emj8cyg","cmtub34kb0003wcqs5nxwa4bv"]},"sortOrder":10,"isVisible":true,"visibleFrom":null,"visibleUntil":null,"createdAt":"2026-09-09T16:24:08.064Z","updatedAt":"2026-09-09T16:24:08.064Z","deletedAt":null},{"id":"cmtub5mf0003i9sqsb3m084bh","pageSlug":"l5-content","type":"FEATURED_PRODUCTS","title":"Featured","config":{"eyebrow":"Picked for you","heading":"Featured","variant":"grid","productIds":["cmtub358z000pwcqsjn1x8qsa","cmtub361w001nwcqsf7pr7kb9"]},"sortOrder":20,"isVisible":true,"visibleFrom":null,"visibleUntil":null,"createdAt":"2026-09-09T16:23:41.244Z","updatedAt":"2026-09-09T16:23:41.244Z","deletedAt":null},{"id":"cmtub0uxm002g9sqsoq6fltwd","pageSlug":"l5-content","type":"TRUST_SIGNALS","title":"Why order here","config":{"items":[{"kind":"delivery","title":"Delivery","subtitle":"48h"},{"kind":"returns","title":"Returns","subtitle":"14 days"}]},"sortOrder":30,"isVisible":true,"visibleFrom":null,"visibleUntil":null,"createdAt":"2026-09-09T16:19:59.002Z","updatedAt":"2026-09-09T16:19:59.002Z","deletedAt":null},{"id":"cmtub0vi4002i9sqstl9qn062","pageSlug":"l5-content","type":"PROMOTIONAL_BANNER","title":"Sale","config":{"body":"On every order until Sunday.","assetId":"6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f","eyebrow":"This week","headline":"Free shipping over 50 EUR"},"sortOrder":40,"isVisible":true,"visibleFrom":null,"visibleUntil":null,"createdAt":"2026-09-09T16:19:59.740Z","updatedAt":"2026-09-09T16:19:59.740Z","deletedAt":null}],"meta":{"pageSlug":"l5-content","total":5,"page":1,"pageSize":5,"totalPages":1}}
```

The envelope: `data` is the ordered list, `meta.total` its length. `page`, `pageSize` and `totalPages` are present for shape only; the route is never paginated, a page has at most a few dozen sections and you always receive all of them.

The rows: every row carries `id`, `pageSlug`, `type`, `title` (resolved text or `null`), `sortOrder`, `isVisible`, `visibleFrom`, `visibleUntil` and `config`. The API applies the visibility rules before answering, so every row you receive is `isVisible: true` and inside its window; you do not re-check `visibleFrom` and `visibleUntil`. The order rule is `sortOrder` ascending, and the operator's drag order in the admin is that field, so render `data` in the order it arrives.

Every text in `config` is a `Translatable` resolved to a string. The wire shape the shipped storefront validates is `libs/storefront-types/src/lib/storefront-config/sections.schemas.ts`; the fields per type:

- `HERO`: `assetId`, `eyebrow`, `headline`, `body`, `cta`, `ctaHref`, optional `imageAlt`. When the asset exists the API adds `assetUrl` (the `large` variant) and `assetVariants` (an array of `{ url, width, format }` for a `srcset`); the row above has neither because its asset id resolves to nothing, which is the missing-field case the rules below cover. Render one hero with the image on one side and the four texts on the other; the shipped component is `apps/storefront/src/app/sections/home/hero-banner.component.ts`.
- `PROMOTIONAL_BANNER`: `assetId`, `eyebrow`, `headline`, `body`, optional `cta` and `ctaHref`, optional `imageAlt`; `assetUrl` and `assetVariants` are added the same way (the `medium` variant). Component: `apps/storefront/src/app/sections/home/campaign-banner.component.ts`. The shipped home page gives the first banner in sort order the strong fill and renders any further one quietly.
- `CATEGORY_SHOWCASE`: `categoryIds` (1 to 12 ids) and optional `heading`. The row carries ids only; you fetch the categories from `GET /v1/categories` and map each id to its card, keeping the configured order. Component: `apps/storefront/src/app/sections/home/categories-grid.component.ts`.
- `FEATURED_PRODUCTS`: `productIds` (1 to 12 ids), `variant` (`scroll` or `grid`), optional `heading` and `eyebrow`. Fetch exactly those products with `GET /v1/products?ids=<comma-separated>` (the shipped loader caps the set at 24 ids across the page) and render them in the configured order. Component: `apps/storefront/src/app/sections/home/product-rail.component.ts`.
- `TRUST_SIGNALS`: `items` (1 to 6), each `{ kind, title, subtitle }` with `kind` one of `delivery`, `returns`, `authentic`, `support`; `kind` picks an icon, the two texts are what the operator wrote. Component: `apps/storefront/src/app/sections/home/trust-strip.component.ts`.

A `ctaHref` is stored once for every locale, either site-relative (`/en/catalog`, `/collections/new`) or an absolute `http(s)` URL; the API refuses any other scheme. The shipped storefront runs it through `apps/storefront/src/lib/section-cta.ts`, which prefixes the current locale when the path has none and falls back to the catalogue when the value is unusable. Do the same: an operator who types `/catalog` should land on `/fr/catalog` from the French home page.

For the heading of a category or product block, the shipped page prefers `config.heading` and falls back to the row's `title`; keep that precedence so the admin's two fields behave the same on your storefront.

### The rules for a type or a field you did not expect

The shipped storefront is built so that operator content can never take the home page down. Its rules, in `apps/storefront/src/app/pages/[locale]/index.server.ts` and `apps/storefront/src/app/pages/[locale]/index.page.ts`:

- A failed sections request renders the page with no sections. The server loader catches the error and returns an empty list; the categories request is the one that may fail the page, the sections request never is.
- A section type you do not render is skipped, never a crash. The shipped storefront keeps a map from `type` to component (`apps/storefront/src/lib/section-component-map.ts`) and validates rows against a union keyed on `type`; a row of a type outside the map has no renderer. Keep a map, look the type up, and drop the row when the lookup fails. The engine can gain a type before your storefront does, and the admin will let an operator configure it.
- An optional field is guarded at the read site. `assetUrl` may be absent, `assetVariants` may be absent, `heading`, `eyebrow`, `cta`, `ctaHref` and `imageAlt` may be absent; the shipped page reads `cfg.assetUrl ?? null`, builds the picture sources from `cfg.assetVariants` only when present, and falls back to `headline` for the alt text. A `.map` on an undefined array is the failure that renders an empty block with no error in any log.
- A curated id that resolves to nothing is dropped, and a block that resolves to nothing renders its own empty state. The page maps `categoryIds` and `productIds` against what it fetched and filters out the misses (a product unpublished after the operator picked it, an id from another store). It does not fill the gap with other products, because that would hide the broken configuration from the operator.
- Extra fields are tolerated. The wire schemas are `passthrough`, so a field the API adds later crosses without a storefront deploy; parse what you know and ignore the rest.
- A hero or banner without an image still renders its texts. The row above proves the case: no `assetUrl`, and the shipped component draws the copy on a plain panel.

### The deprecated banners route

`GET /v1/storefront/home-banners` still answers, with every field `null` on a current store:

```http
HTTP/1.1 200 OK
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
```

```json
{"data":{"hero":{"imageUrl":null,"altText":null},"midBanner":{"imageUrl":null,"altText":null}}}
```

It predates the sections route and is kept for one release so an older client can move; the response is the same under `fr`. Do not build on it.

## Error codes

Codes and statuses from [Error codes](../reference/error-codes.md); every body is the standard envelope from [Conventions](../customize/conventions.md#response-and-error-envelopes).

- `NOT_FOUND` (404) on `GET /v1/pages/{slug}`: no published page has that slug (an unpublished or deleted page answers the same). The storefront renders its 404 page with the status 404, as the shipped `apps/storefront/src/app/pages/[locale]/pages/[slug].server.ts` does; do not redirect to the home page.
- `BAD_REQUEST` (400) on `GET /v1/storefront/sections/{pageSlug}`: the slug is not lowercase kebab of 1 to 64 characters. Only a programming error reaches it; a storefront never builds this slug from user input.
- `RATE_LIMITED` (429) on all four routes: the storefront read limiter. Retry after `Retry-After`; a server-rendered storefront that fetches sections on every request should cache them (see "Framework notes").

An unknown `pageSlug` is not an error: the sections route answers an empty list, `{"data":[],"meta":{"pageSlug":"no-such-page","total":0,"page":1,"pageSize":0,"totalPages":1}}` on the run, so a page with no sections yet renders as an empty page, not a 404.

Proof, the unknown page slug:

```http
HTTP/1.1 404 Not Found
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
```

```json
{"error":{"code":"NOT_FOUND","message":"CMS page \"/no-such-page\" not found","details":{"message":"CMS page \"/no-such-page\" not found","error":"Not Found","statusCode":404}}}
```

`details` is present because the engine ran in development; production strips it. Map `code`, not `message`, to your own text in each locale.

And the bad page slug, `GET /v1/storefront/sections/Bad_Slug`: status `400`, code `BAD_REQUEST`, message `Invalid pageSlug "Bad_Slug"` followed by the rule (the full message is in the run transcript; it carries typographic dashes this site does not print).

## Every locale

The same page under `Accept-Language: en` and `Accept-Language: fr`:

```json
{"data":{"id":"cmtuazors001p9sqsg491nb23","title":"Delivery and returns","slug":"/l5-content-demo","content":"<h2>Delivery</h2><p>Orders ship within <strong>two working days</strong>.</p><ul><li>Tracking is emailed on dispatch.</li></ul><p><a href=\"/en/pages/contact\">Contact us</a> with any question.</p><p>Styled</p>","type":"STATIC","isPublished":true,"metaTitle":null,"metaDescription":null,"sortOrder":50,"showInNavigation":false,"template":null,"createdAt":"2026-09-09T16:19:04.360Z","updatedAt":"2026-09-09T16:19:04.360Z","deletedAt":null}}
```

```json
{"data":{"id":"cmtuazors001p9sqsg491nb23","title":"Livraison et retours","slug":"/l5-content-demo","content":"<h2>Livraison</h2><p>Les commandes partent sous <strong>deux jours ouvrés</strong>.</p><ul><li>Le suivi est envoyé par e-mail à l'expédition.</li></ul><p><a href=\"/fr/pages/contact\">Contactez-nous</a> pour toute question.</p>","type":"STATIC","isPublished":true,"metaTitle":null,"metaDescription":null,"sortOrder":50,"showInNavigation":false,"template":null,"createdAt":"2026-09-09T16:19:04.360Z","updatedAt":"2026-09-09T16:19:04.360Z","deletedAt":null}}
```

`title` and `content` change, everything else is identical. The French body has no `Styled` paragraph because that locale's text never had one, which is the point: the operator writes each locale's HTML separately, and a link inside it (`/fr/pages/contact`) is whatever they typed for that locale.

The sections under `fr`, trimmed to the first two rows of the same five:

```json
{"data":[{"id":"cmtub0tpw002a9sqsoe0yq5ca","pageSlug":"l5-content","type":"HERO","title":"Accueil","config":{"cta":"Voir le catalogue","body":"Livré sous 48 h.","assetId":"6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f","ctaHref":"/en/catalog","eyebrow":"Nouvelle saison","headline":"Tout pour l'atelier","imageAlt":"Un établi"},"sortOrder":0,"isVisible":true,"visibleFrom":null,"visibleUntil":null,"createdAt":"2026-09-09T16:19:57.429Z","updatedAt":"2026-09-09T16:19:57.429Z","deletedAt":null},{"id":"cmtub6740003n9sqsxodbypw8","pageSlug":"l5-content","type":"CATEGORY_SHOWCASE","title":"Par catégorie","config":{"heading":"Par catégorie","categoryIds":["cmtub348d0000wcqs7emj8cyg","cmtub34kb0003wcqs5nxwa4bv"]},"sortOrder":10,"isVisible":true,"visibleFrom":null,"visibleUntil":null,"createdAt":"2026-09-09T16:24:08.064Z","updatedAt":"2026-09-09T16:24:08.064Z","deletedAt":null}]}
```

Every text collapses to the French value; `ctaHref`, `assetId`, the ids, `sortOrder` and the dates do not change, and `ctaHref` keeps the `/en/` prefix the operator typed, which is why the locale-prefix rule above exists. The pages list changes the same way: `"À propos"`, `"Nous contacter"`, `"Politique de retour"` for the seeded titles. The `demo` fixture has two left-to-right locales, so nothing else moves; a store with a right-to-left locale answers the same JSON and your `dir` attribute comes from the store config, not from these routes.

## Framework notes

These four routes are public and identical for every visitor, so cache their output at your edge for as long as the store's revalidation contract allows and purge when the engine calls your revalidation route ([Revalidation](./10-revalidation.md)). The engine calls it for every page's paths when a section of that page is saved, and for the home and `llms.txt` paths when the store config changes; the API itself keeps the sections in Redis for ten minutes and drops that key on every mutation, so a request after a purge is fresh.

- Next.js: fetch sections in a server component with `fetch(url, { next: { tags: ['sections:home'] } })` and call `revalidateTag('sections:home')` from the revalidation route handler; a page generated statically at build time keeps the sections it was built with until that call, a page rendered per request re-reads them and still benefits from the tag cache. Render `content` with `dangerouslySetInnerHTML`.
- Nuxt: `routeRules: { '/**': { swr: 600 } }` (or `isr`) caches the rendered page; the revalidation route purges the Nitro cache for the paths it receives. Render `content` with `v-html`.
- SvelteKit: a `+page.server.ts` `load` that fetches sections and a `Cache-Control: public, s-maxage=600` on the response; a prerendered page (`export const prerender = true`) is only rebuilt by a deploy, so leave the home page server-rendered when operators edit it. Render `content` with `{@html page.content}`.
- The difference to decide up front: static generation bakes an admin-edited page at build time, so the operator's save shows only after the revalidation call (or a rebuild); server rendering reads the API on every request, so the save shows within the ten-minute API cache, and the edge cache you put in front of it is what needs the purge.

The long form of cookie forwarding, the idempotency key on a retried action and the `304` rule is on [Framework notes](./framework-notes.md).
