---
title: Change SEO and GEO output
description: "Where the storefront's JSON-LD, canonical and hreflang come from, how sitemaps, robots.txt and the llms.txt files are proxied from the API through Nitro server routes, and the IndexNow ping the API sends when a product becomes visible."
primaryQuery: change json-ld sitemap robots llms.txt indexnow ecommerce storefront
updated: 2026-09-09
schema: HowTo
---

## When you need this

You want to change what crawlers and AI agents read: a new JSON-LD field, a different canonical shape, another crawler in `robots.txt`, a section in `llms.txt`, or a search engine ping on a different event. Two processes produce this output. The storefront (Angular under Nitro) writes the per-page head and JSON-LD at render time. The API builds the site-wide text surfaces, caches them in Redis, and pushes URL changes to IndexNow. The storefront's job for those surfaces is to proxy them from the API so they answer on the public origin. This page names each builder and its guard.

## Files you touch

- `apps/storefront/src/lib/seo.ts`: `organizationJsonLd`, `websiteJsonLd`, `breadcrumbListJsonLd`, `itemListJsonLd`, `productJsonLd`, the meta-tag builders and `hreflangSet`. Every payload is parsed through a Zod schema before it is emitted.
- `apps/storefront/src/lib/locale-region.ts`: the region tail for `hreflang` (`fr-XX`) and `og:locale` (`fr_XX`), derived from the configured country.
- `apps/storefront/src/server/proxy-seo.ts`: `proxyTextSurface`, the shared proxy every text surface route uses.
- `apps/storefront/src/server/routes/sitemap_index.xml.ts`, `sitemap.xml.ts`, `sitemap-products.xml.ts`, `sitemap-categories.xml.ts`, `sitemap-pages.xml.ts`, `robots.txt.ts`, `llms.txt.ts`, `llms-full.txt.ts`, `llms_full.txt.ts`: one Nitro route per public path.
- `apps/storefront/vite.config.ts`: the dev-server proxy rules that mirror those routes, because Nitro middleware only mounts at `/api` in dev.
- `apps/api/src/modules/seo/seo.service.ts`: sitemap and `robots.txt` builders; `apps/api/src/modules/seo/seo-storefront.controller.ts`: the `@Public()` endpoints; `apps/api/src/modules/seo/seo.constants.ts`: `AI_CRAWLERS` and the cache keys.
- `apps/api/src/modules/geo/geo.service.ts` and `apps/api/src/modules/geo/geo-storefront.controller.ts`: `llms.txt` and `llms-full.txt`.
- `apps/api/src/modules/webhooks/revalidation.listener.ts` and `apps/api/src/modules/seo/search-engine-submit.service.ts`: the IndexNow trigger and the submission.

## The pattern

### 1. Change a JSON-LD payload in its builder, then its schema

Each builder in `apps/storefront/src/lib/seo.ts` assembles a typed object and returns `schema.parse(payload)`, so a field the schema does not know is a thrown error in the unit spec, not a silent emit:

```ts
const productJsonLdSchema = z.object({
  '@context': z.literal(JSON_LD_CONTEXT),
  '@type': z.literal('Product'),
  name: z.string().min(1),
  description: z.string().min(1),
  image: z.array(z.string().url()).min(1),
  sku: z.string().optional(),
  brand: z.object({ '@type': z.literal('Brand'), name: z.string().min(1) }).optional(),
  itemCondition: z.literal(ITEM_CONDITION_NEW),
  offers: productOfferSchema,
  aggregateRating: productAggregateRatingSchema.optional(),
  review: z.array(productReviewSchema).optional(),
});
```

The price string uses `moneyFractionDigits(input.money, input.currency)`, so a three-decimal currency emits three decimals. `description` goes through `stripHtml` because the field is admin-authored rich text. The page then writes the result with `serializeJsonLd`, which escapes `</script` inside the JSON.

### 2. Keep canonical and hreflang on the shared helpers

`hreflangSet` fans one path out across the store's locales and adds `x-default` at the configured default:

```ts
export function hreflangSet(baseUrl, pathFor, locales) {
  return [
    ...locales.supportedLocales.map((locale) => ({
      hreflang: regionFromLocale(locale, locales),
      href: joinUrl(baseUrl, pathFor(locale)),
    })),
    { hreflang: 'x-default', href: joinUrl(baseUrl, pathFor(locales.defaultLocale)) },
  ];
}
```

`regionFromLocale` in `apps/storefront/src/lib/locale-region.ts` returns `${locale}-${COUNTRY}` from `identity.address.country`, and the bare language tag when no country is configured. The API keeps a mirror in `apps/api/src/modules/seo/locale-region.ts` for the sitemap `xhtml:link` entries, with `locale-region.spec.ts` asserting the two agree. A page passes `storeConfig.seoLocales()` in; nothing hardcodes a locale pair.

### 3. Proxy a text surface, do not rebuild it

`apps/storefront/src/server/proxy-seo.ts` fetches the API path, copies the body byte for byte, and sets the storefront's own headers:

```ts
const acceptLanguage = opts.forwardAcceptLanguage
  ? (getRequestHeader(event, 'accept-language') ?? DEFAULT_LOCALE)
  : DEFAULT_LOCALE;

upstream = await fetchImpl(url, {
  method: 'GET',
  headers: { Accept: opts.contentType, 'Accept-Language': acceptLanguage, 'X-Request-Id': requestId },
});
if (!upstream.ok) {
  setResponseStatus(event, 502);
  return `Upstream responded ${upstream.status}`;
}
setResponseHeader(event, 'Content-Type', opts.contentType);
setResponseHeader(event, 'Cache-Control', opts.cacheControl);
if (opts.forwardAcceptLanguage) setResponseHeader(event, 'Vary', 'Accept-Language');
```

A route is a few lines. `apps/storefront/src/server/routes/llms.txt.ts`:

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

Sitemaps and `robots.txt` leave `forwardAcceptLanguage` off; the two `llms` files turn it on because the API resolves them per language. `sitemap.xml.ts` and `llms_full.txt.ts` are 301s to `/sitemap_index.xml` and `/llms-full.txt`. When you add a route, add the matching entry to the `server.proxy` block of `apps/storefront/vite.config.ts` (lines 143-220) or the dev server answers HTML for it. As it stands the block has entries for the four sitemaps, `/sitemap.xml`, `/robots.txt` and `/llms.txt`, and none for `/llms-full.txt`: the Nitro route serves that file on the production build, and the dev server answers the Angular shell for it.

### 4. Change the API builder

`robots.txt` is built once per hour in `SeoService.getRobotsTxt` (`apps/api/src/modules/seo/seo.service.ts`) and cached under `seo:robots`:

```ts
const lines: string[] = [
  `# AI content guide: ${siteUrl}/llms.txt`,
  '',
  'User-agent: *',
  'Allow: /',
  'Disallow: /v1/admin/',
  'Disallow: /v1/auth/',
  'Disallow: /checkout',
  'Disallow: /account',
  'Disallow: /cart',
  'Disallow: /search?',
  '',
];
for (const bot of AI_CRAWLERS) {
  lines.push(`User-agent: ${bot}`, 'Allow: /', '');
}
lines.push(`Sitemap: ${siteUrl}/sitemap_index.xml`);
```

Add a crawler to `AI_CRAWLERS` in `seo.constants.ts`, then to the roster in `apps/api/src/modules/seo/seo.service.spec.ts` (lines 1190-1208): that test holds the same eleven names in a `docRoster` array and asserts `[...AI_CRAWLERS]` equals it, so the constant alone fails `npx nx test api`. Every sitemap builder prefixes its XML with `<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>`; the stylesheet is the static file `apps/storefront/public/sitemap.xsl`. The endpoints in `seo-storefront.controller.ts` are `@Public()`, rate limited with `RateLimit.StorefrontRead()`, and `@PublicCacheable(3600)`; the `llms` endpoints in `geo-storefront.controller.ts` add `Accept-Language` to `Vary`.

### 5. Ping IndexNow on the right event

`apps/api/src/modules/webhooks/revalidation.listener.ts` reacts to product mutations. The service decides whether the change affected public visibility and puts that on the event, so the listener never reads the database:

```ts
@OnEvent(PRODUCT_MUTATED_EVENT, { async: true })
async onProductMutated(payload: ProductMutatedEventPayload): Promise<void> {
  await this.dispatch(this.sitemapPaths(), 'product.write');
  await this.enqueueRegen('products', PRODUCT_MUTATED_EVENT);
  if (payload?.shouldSubmitIndexNow && payload.slug) {
    await this.submitProductIndexNow([payload.slug]);
  }
}
```

`submitProductIndexNow` builds one URL per configured locale and calls `SearchEngineSubmitService.submitToIndexNow(urls, siteUrl)`, which returns `{ accepted: false, reason: 'INDEXNOW_KEY unset' }` without a key, drops any URL submitted in the last five minutes through a Redis claim, and posts to `https://api.indexnow.org/indexnow` in batches. Every outcome is recorded by `SeoSubmissionService.recordEngineResult` and shown on the admin SEO screen. Google does not take IndexNow; it discovers the sitemap from `robots.txt`.

## Tests to run

```bash
npx nx test storefront
npx nx test api
npx nx e2e storefront-e2e --grep=seo
npx nx e2e storefront-e2e --grep=product-detail-ssr
npm run test:storefront-ssr-smoke
```

- `npx nx test storefront` runs `apps/storefront/src/lib/seo.spec.ts` (the builders and schemas), `apps/storefront/src/lib/locale-region.spec.ts`, `apps/storefront/src/server/proxy-seo.spec.ts` and the route specs under `apps/storefront/src/server/__tests__/`.
- `npx nx test api` runs `apps/api/src/modules/seo/seo.service.spec.ts`, `locale-region.spec.ts` (parity with the storefront map), `search-engine-submit.service.spec.ts` and `apps/api/src/modules/webhooks/revalidation.listener.spec.ts`.
- `apps/storefront-e2e/src/seo.journey.spec.ts` reads `/sitemap_index.xml`, the 301 on `/sitemap.xml`, `/sitemap-products.xml`, `robots.txt` and the `llms` files over plain HTTP and asserts the `noindex` tag on private routes. `product-detail-ssr.journey.spec.ts` parses the JSON-LD out of the raw SSR HTML.
- The smoke boots the production Nitro build and includes a control leg that reads the product page's `Product` JSON-LD.

## Gotchas

- The API caches each surface in Redis: the sitemaps for six hours (`SEO_SITEMAP_TTL_SECONDS` in `apps/api/src/modules/seo/seo.constants.ts`, line 76), `seo:robots` for one hour (`SEO_ROBOTS_TTL_SECONDS`, line 78) and the `llms` files for six (`GEO_LLMS_TXT_TTL_SECONDS` in `apps/api/src/modules/geo/geo.constants.ts`). A builder change shows up after the TTL or a regen job, not on the next request.
- The IndexNow key file is not in `apps/storefront/public/`. The rule is line 39 of the root `.gitignore`, `apps/storefront/public/[a-f0-9]*.txt`; that directory has no `.gitignore` of its own. The installer writes it next to the rendered compose file and edge nginx serves it, as `apps/storefront/public/README-search-submission.md` explains. A key set in `INDEXNOW_KEY` with no served file is rejected by IndexNow.
- `robots.txt` disallows `/search?`, so the search results page is intentionally not crawled. The `WebSite` JSON-LD still advertises the search action.
- `organizationJsonLd` filters every configured social URL through an absolute-URL check and drops the bad ones rather than throwing. The schema parse would otherwise take the home page down for one junk row.
- The private routes (`account`, `cart`, `checkout`, `order-confirmation`, `auth`) emit `noindex, nofollow` and no `hreflang`. Do not add a loader or a canonical to them.
- `og:locale` uses an underscore and `hreflang` a hyphen. Both come from `locale-region.ts`; a page that formats its own string will drift.
- The dev proxy in `vite.config.ts` rewrites `/path` to `/api/v1/path`. In the e2e harness the API base already includes `/api` and `STOREFRONT_API_TARGET_PREFIX` is set to an empty string; a new surface that skips the shared `seoRewrite` helper breaks under one of the two.
