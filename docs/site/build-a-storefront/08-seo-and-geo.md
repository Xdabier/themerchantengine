---
title: SEO and GEO
description: "The sitemap index and its three sitemaps, robots.txt, llms.txt and llms-full.txt that the API builds with your storefront's URLs and that your storefront serves at its own root, the redirect table it honours with a 301 before routing, the IndexNow ping the engine sends, and the JSON-LD, canonical, hreflang, lang and dir a storefront emits per page type, with one product's JSON-LD built from the pasted response."
primaryQuery: sitemap robots.txt llms.txt json-ld hreflang canonical ecommerce api storefront proxy
updated: 2026-09-09
schema: TechArticle
---

The engine builds the site-wide text surfaces a crawler reads (the sitemap index, three sitemaps, `robots.txt`, `llms.txt`, `llms-full.txt`) and the redirect table, all with your storefront's public URLs in them, and it pings IndexNow when a product becomes visible. Your storefront serves those files at its own root with the same body, answers the redirects with a `301` before it routes, and writes the per-page head itself: JSON-LD, the canonical, the `hreflang` pair with `x-default`, and `lang` and `dir` on `<html>`. That is obligation eight and obligation nine of [the contract](./index.md#the-ten-obligations). This page runs every surface against the `demo` fixture, says what the storefront does with each, and shows the JSON-LD one product page emits, field by field from the product response. A developer editing the shipped storefront's output instead of building their own reads [Change SEO and GEO output](../customize/recipes/storefront/change-seo-and-geo-output.md); this page links it rather than repeating it.

## The request

Every route is `GET`, public, without a cookie; full parameter lists on [SEO (storefront API)](../reference/storefront-api/seo.md).

- `GET /v1/sitemap_index.xml` is the index. `GET /v1/sitemap.xml` is an alias that answers `301` to it.
- `GET /v1/sitemap-products.xml`, `GET /v1/sitemap-categories.xml`, `GET /v1/sitemap-pages.xml`: the three children the index names.
- `GET /v1/robots.txt`: the crawler roster and the sitemap pointer.
- `GET /v1/llms.txt` and `GET /v1/llms-full.txt`: the store summary and the expanded catalogue for AI crawlers, resolved per `Accept-Language`.
- `GET /v1/seo/redirects`: every redirect row, JSON.

Headers that matter: `Accept-Language` only on the two `llms` files (they answer `Vary: Accept-Language`); the sitemaps, `robots.txt` and the redirects ignore it. The API answers `Cache-Control: public, max-age=3600` on the text surfaces and `public, max-age=300` on the redirects, so a browser or a CDN may hold them; the ETag stays off engine-wide ([Conventions](../customize/conventions.md#browser-caching-and-304)).

```bash
curl -s https://api.shop.example/api/v1/sitemap_index.xml
curl -s https://api.shop.example/api/v1/robots.txt
curl -s -H "Accept-Language: fr" https://api.shop.example/api/v1/llms.txt
curl -s https://api.shop.example/api/v1/seo/redirects
```

The proxy in `fetch`, for Node 22 (a browser never calls these routes; a crawler asks your server and your server asks the API):

```js
const API = 'https://api.shop.example/api/v1';

// One handler per public path. Copy the body byte for byte, set your own headers.
async function proxyText(upstreamPath, contentType, acceptLanguage) {
  const res = await fetch(`${API}${upstreamPath}`, {
    headers: { Accept: contentType, ...(acceptLanguage ? { 'Accept-Language': acceptLanguage } : {}) },
  });
  if (!res.ok) return new Response(`Upstream responded ${res.status}`, { status: 502 });
  const headers = { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=300, s-maxage=3600' };
  if (acceptLanguage) headers['Vary'] = 'Accept-Language';
  return new Response(await res.text(), { status: 200, headers });
}

// GET https://shop.example/sitemap_index.xml
const sitemapIndex = await proxyText('/sitemap_index.xml', 'application/xml; charset=utf-8');
// GET https://shop.example/llms.txt (forward the visitor's Accept-Language)
const llms = await proxyText('/llms.txt', 'text/plain; charset=utf-8', 'fr');
```

`/llms.txt` and `/llms-full.txt` carry no locale in their path, so the storefront forwards the visitor's `Accept-Language` header as received, or sends the store's default locale when the request has none. The API reads the first entry of that header against the store's locales and falls back to the default locale, so `fr-FR,fr;q=0.9,en;q=0.8` answered `# Boutique Démo` and a request without the header answered `# Demo Store` on the `demo` fixture. Answer `Vary: Accept-Language` on both files so a shared cache keeps one copy per language.

## The response

### How the API knows your storefront's URL

Every URL in these files is built from the environment variable `STOREFRONT_PUBLIC_BASE_URL` on the API side (the older name `SITE_URL` is still read as a fallback; both are in [Environment variables](../reference/environment-variables.md)). In development it defaults to `http://localhost:53300`, which is why every run below shows that host; in production the API refuses to boot without the variable. It is not read from the `domains` block of `GET /v1/store/config`: on this run that block said `"domains":{"storefront":"https://demo.example","admin":"https://admin.demo.example","api":"https://api.demo.example"}` while the sitemap said `http://localhost:53300`. Set the variable to the origin your storefront answers on, and set the same value on the storefront side, where the shipped app reads it for its canonical and JSON-LD URLs (`apps/storefront/src/app/pages/[locale]/catalog/product/[slug].page.ts`, `resolveBaseUrl`).

The paths under that origin are fixed by the engine: `/{locale}/` (home), `/{locale}/catalog`, `/{locale}/catalog/{categorySlug}`, `/{locale}/catalog/product/{productSlug}`, `/{locale}/pages/{pageSlug}` (source: `apps/api/src/modules/seo/site-url.ts`, `entityPath`). Your storefront must answer at exactly these paths, otherwise the sitemap and the IndexNow ping advertise URLs that 404. The pages sitemap also lists `/{locale}/about` and `/{locale}/policies/privacy`, `/policies/returns`, `/policies/terms`, `/policies/shipping` for the five seeded pages whose slugs are `/about`, `/privacy-policy`, `/return-policy`, `/terms` and `/shipping-info`; the shipped storefront serves them at those routes, so serve them there too or the sitemap lists them twice.

### The sitemap index

`GET /v1/sitemap.xml`, the alias:

```http
HTTP/1.1 301 Moved Permanently
Cache-Control: no-store
Location: /v1/sitemap_index.xml
Content-Type: text/plain; charset=utf-8
```

Your storefront does not proxy that answer (the `Location` points into the API); it issues its own `301` from `/sitemap.xml` to `/sitemap_index.xml`, as `apps/storefront/src/server/routes/sitemap.xml.ts` does. `GET /v1/sitemap_index.xml`:

```http
HTTP/1.1 200 OK
Cache-Control: public, max-age=3600
Content-Type: application/xml; charset=utf-8
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>http://localhost:53300/sitemap-products.xml</loc><lastmod>2026-09-01T12:26:05.949Z</lastmod></sitemap>
  <sitemap><loc>http://localhost:53300/sitemap-categories.xml</loc><lastmod>2026-08-31T17:37:20.715Z</lastmod></sitemap>
  <sitemap><loc>http://localhost:53300/sitemap-pages.xml</loc><lastmod>2026-08-30T16:11:11.222Z</lastmod></sitemap>
</sitemapindex>
```

The three `<loc>` values are on your origin, so serve the three children at those paths. `<lastmod>` is the newest real change among the rows a child lists, not the time the file was built. The stylesheet line names `/sitemap.xsl`, a static file the shipped storefront ships in `apps/storefront/public/sitemap.xsl`; serve one or drop nothing, a crawler ignores the processing instruction.

### One child sitemap

`GET /v1/sitemap-pages.xml`, trimmed to its first four `<url>` entries (the file goes on with every published page in both locales):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url><loc>http://localhost:53300/en/</loc><changefreq>daily</changefreq><priority>1.0</priority><xhtml:link rel="alternate" hreflang="en-FR" href="http://localhost:53300/en/"/><xhtml:link rel="alternate" hreflang="fr-FR" href="http://localhost:53300/fr/"/><xhtml:link rel="alternate" hreflang="x-default" href="http://localhost:53300/en/"/></url>
  <url><loc>http://localhost:53300/fr/</loc><changefreq>daily</changefreq><priority>1.0</priority><xhtml:link rel="alternate" hreflang="en-FR" href="http://localhost:53300/en/"/><xhtml:link rel="alternate" hreflang="fr-FR" href="http://localhost:53300/fr/"/><xhtml:link rel="alternate" hreflang="x-default" href="http://localhost:53300/en/"/></url>
  <url><loc>http://localhost:53300/en/catalog</loc><changefreq>daily</changefreq><priority>0.9</priority><xhtml:link rel="alternate" hreflang="en-FR" href="http://localhost:53300/en/catalog"/><xhtml:link rel="alternate" hreflang="fr-FR" href="http://localhost:53300/fr/catalog"/><xhtml:link rel="alternate" hreflang="x-default" href="http://localhost:53300/en/catalog"/></url>
  <url><loc>http://localhost:53300/fr/catalog</loc><changefreq>daily</changefreq><priority>0.9</priority><xhtml:link rel="alternate" hreflang="en-FR" href="http://localhost:53300/en/catalog"/><xhtml:link rel="alternate" hreflang="fr-FR" href="http://localhost:53300/fr/catalog"/><xhtml:link rel="alternate" hreflang="x-default" href="http://localhost:53300/en/catalog"/></url>
```

Every page of the store appears once per locale, and each entry carries the full alternate set: one `xhtml:link` per locale plus `x-default`. The region tail of `hreflang` (`-FR`) is the country of the store's business address, the same value the storefront uses for its own `hreflang` and `og:locale` (next section), and `x-default` points at the store's default locale (`en` on the `demo` fixture). Product entries add `<image:image><image:loc>` with the primary photo's detail variant, the same URL the product page puts in `og:image`; categories and pages carry `<lastmod>` from the row's `updatedAt`.

The products child, `GET /v1/sitemap-products.xml`, trimmed to the two entries of one fixture product (the file lists every active product in both locales, and the products with a photo carry the image element described above):

```xml
  <url><loc>http://localhost:53300/en/catalog/product/fx-laptop-compact-12-se</loc><lastmod>2026-09-09T16:21:45.683Z</lastmod><changefreq>weekly</changefreq><priority>0.8</priority><xhtml:link rel="alternate" hreflang="en-FR" href="http://localhost:53300/en/catalog/product/fx-laptop-compact-12-se"/><xhtml:link rel="alternate" hreflang="fr-FR" href="http://localhost:53300/fr/catalog/product/fx-laptop-compact-12-se"/><xhtml:link rel="alternate" hreflang="x-default" href="http://localhost:53300/en/catalog/product/fx-laptop-compact-12-se"/></url>
  <url><loc>http://localhost:53300/fr/catalog/product/fx-laptop-compact-12-se</loc><lastmod>2026-09-09T16:21:45.683Z</lastmod><changefreq>weekly</changefreq><priority>0.8</priority><xhtml:link rel="alternate" hreflang="en-FR" href="http://localhost:53300/en/catalog/product/fx-laptop-compact-12-se"/><xhtml:link rel="alternate" hreflang="fr-FR" href="http://localhost:53300/fr/catalog/product/fx-laptop-compact-12-se"/><xhtml:link rel="alternate" hreflang="x-default" href="http://localhost:53300/en/catalog/product/fx-laptop-compact-12-se"/></url>
```

The API keeps each sitemap in Redis for six hours and rebuilds it on a schedule and after a product change; a product you publish appears in the file within that window, not on the next request.

### robots.txt

`GET /v1/robots.txt`:

```http
HTTP/1.1 200 OK
Cache-Control: public, max-age=3600
Content-Type: text/plain; charset=utf-8
```

```text
# AI content guide: http://localhost:53300/llms.txt

User-agent: *
Allow: /
Disallow: /v1/admin/
Disallow: /v1/auth/
Disallow: /checkout
Disallow: /account
Disallow: /cart
Disallow: /search?

User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Perplexity-User
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Bingbot
Allow: /

User-agent: CCBot
Allow: /

Sitemap: http://localhost:53300/sitemap_index.xml
```

The `Disallow` lines name your storefront's private routes, so keep `/checkout`, `/account`, `/cart` and `/search?` as your route names or the file disallows paths you do not have and allows the ones you do. The eleven named crawlers are the AI roster the engine allows explicitly; the `Sitemap` line is the reason Google finds the index without any submission.

### llms.txt and llms-full.txt

`GET /v1/llms.txt` under `Accept-Language: en`, the head (the file continues with one line per category, then the pages):

```http
HTTP/1.1 200 OK
Cache-Control: public, max-age=3600
Vary: Accept-Language
Content-Type: text/plain; charset=utf-8
```

```text
# Demo Store

> A demonstration store for themerchantengine.

## About

- [About](http://localhost:53300/en/about)

## Categories

```

`GET /v1/llms-full.txt` under `Accept-Language: en`, the first lines (the file is the expanded catalogue: every category with its description and every product with its price, about 60 KB on this store):

```text
# Demo Store

> A demonstration store for themerchantengine.

## Categories

```

Both are Markdown, both are resolved for the language in `Accept-Language` (the store's default when the header names none of its locales), and the URLs inside them are on your origin with the locale prefix of that language. Serve them at `/llms.txt` and `/llms-full.txt`, forward the visitor's `Accept-Language` upstream and answer `Vary: Accept-Language`, which is what `apps/storefront/src/server/routes/llms.txt.ts` and `apps/storefront/src/server/routes/llms-full.txt.ts` do; the shipped storefront also answers `301` from `/llms_full.txt` to `/llms-full.txt`.

### The redirects

`GET /v1/seo/redirects`:

```http
HTTP/1.1 200 OK
Cache-Control: public, max-age=300
Content-Type: application/json; charset=utf-8
```

```json
{"fromPath":"/en/catalog/product/fx-laptop-compact-12","toPath":"/en/catalog/product/fx-laptop-compact-12-se","permanent":true}
```

That is one row of the `data` array, the one created for this run (the dev store's own rows, one per renamed slug, are trimmed). The whole answer is `{"data":[...]}` with the rows sorted by `fromPath`. Each row is a storefront path (with the locale prefix) to a storefront path and a boolean: `permanent: true` is a `301`, `false` a `302`. The engine writes a row itself whenever an operator changes a product or category slug, so this table is how the old URL keeps its ranking.

What the storefront does with it (source: `apps/storefront/src/server/middleware/seo-redirect.ts`): fetch the table, keep it for five minutes, and on every page request, before routing, look the path up with and without its trailing slash and in its decoded form; on a hit answer the redirect with the query string carried over, then stop. The lookup is a middleware on every request, not a route, because the paths it matches are the ones your router would otherwise answer `404` for. The same middleware turns a product, category or page path that the sitemap does not know and the API answers `404` for into a real `404` status while still rendering the error page, so a deleted product is not a soft `404`. The API has its own redirect middleware for paths on the API host, which never applies to a storefront.

### The IndexNow ping

When a product becomes visible, changes slug or is unpublished, the engine posts to `https://api.indexnow.org/indexnow` with one URL per configured locale, `${STOREFRONT_PUBLIC_BASE_URL}/${locale}/catalog/product/${slug}` (both the old and the new slug on a rename; categories and pages ping their own paths the same way). The ping needs `INDEXNOW_KEY` set on the API and the file `https://shop.example/${INDEXNOW_KEY}.txt` served by your storefront with the key as its body; without the key the engine records `INDEXNOW_KEY unset` and sends nothing, and with the key and no file IndexNow rejects the batch. Serve that one static file at your root. The URLs pinged are the URLs in the sitemap, so the path rule above covers both. Google does not take IndexNow; it reads the sitemap from `robots.txt`.

### The head your storefront writes

The API exposes no JSON-LD endpoint (its SEO service holds schema builders, but no storefront route serves them); the storefront builds the head from the responses it already has. The shipped storefront's builders are in `apps/storefront/src/lib/seo.ts`, each one a typed object parsed through a schema before it is written, and every payload is serialised with `</script` escaped. Per page type:

- Home (`/{locale}/`): `Organization` and `WebSite`. `Organization` takes `name` from the store's `identity.storeName`, `url` from `${baseUrl}/${locale}/`, `logo` from the resolved logo URL (`/brand/default/app-icon-512.png` when the operator uploaded none), `description`, `inLanguage`, `areaServed` (the country), `sameAs` (every social link that is an absolute URL; a bad one is dropped, not thrown), and a `ContactPoint` with the contact email, the phone and `availableLanguage` set to the store's locales. `WebSite` carries `name`, `url`, `inLanguage` and a `SearchAction` whose `urlTemplate` is `${baseUrl}/${locale}/search?q={search_term_string}` with `'query-input': 'required name=search_term_string'`.
- Category (`/{locale}/catalog/{slug}`), the catalogue landing page and the search page: `ItemList` over the first page of products, each `ListItem` with `position`, `name` and `url` at `/{locale}/catalog/product/{slug}`, and `numberOfItems`.
- Product (`/{locale}/catalog/product/{slug}`): `Product` with `Offer`, plus `BreadcrumbList` (home, the first category, the product) and `FAQPage` when the product has FAQ entries in the locale.
- The about page: `Organization` again.
- The private routes (`account`, `cart`, `checkout`, `order-confirmation`, `auth`) emit `<meta name="robots" content="noindex, nofollow">`, no JSON-LD, no canonical and no `hreflang`.

On every indexable page the head also carries `<link rel="canonical">` at `${baseUrl}/${locale}${path}`, one `<link rel="alternate" hreflang="...">` per store locale with the region tail plus `x-default` at the default locale, `og:locale` (`en_FR`, underscore) with `og:locale:alternate` for the other locales, and the product pages add `product:price:amount`, `product:price:currency` and `product:availability`. `lang` and `dir` are set on `<html>` from the current locale and the store config's direction (`apps/storefront/src/app/locale.service.ts`), never from the browser's language.

### One product's JSON-LD from its response

The product response the page is built from, `GET /v1/products/fx-laptop-compact-12-se` under `Accept-Language: en`:

```json
{"data":{"id":"cmtub358z000pwcqsjn1x8qsa","name":"Northwind Compact 12 SE Laptop","slug":"fx-laptop-compact-12-se","description":"Crafted for daily productivity: long battery life, a quiet keyboard, and a clear display tuned for bright daylight. The Northwind Compact 12 SE ships with a one-year warranty and a full keyboard.","shortDescription":"Lightweight compact 12 se laptop tuned for everyday work.","status":"ACTIVE","productTypeId":null,"brand":null,"brandId":null,"gtin":null,"mpn":null,"tags":["laptop","electronics","cod-eligible","bestseller"],"isFeatured":false,"isDigital":false,"sortOrder":0,"metaTitle":"Northwind Compact 12 SE Laptop","metaDescription":"Compact 12 SE laptop with a one-year warranty and a full keyboard, shipped fast.","publishedAt":"2026-09-09T16:21:45.683Z","createdAt":"2026-09-09T16:21:45.683Z","updatedAt":"2026-09-09T16:21:45.683Z","deletedAt":null,"variants":[{"id":"cmtub3597000qwcqsbamft6qb","productId":"cmtub358z000pwcqsjn1x8qsa","sku":"FX-LAP-CPT12-SE","price":1299,"compareAtPrice":"1499","isDefault":true,"availability":"IN_STOCK"}],"assets":[],"faqs":[],"specs":[],"categories":[{"productId":"cmtub358z000pwcqsjn1x8qsa","categoryId":"cmtub348d0000wcqs7emj8cyg","category":{"id":"cmtub348d0000wcqs7emj8cyg","name":"Electronics","slug":"fx-electronics"}}],"productType":null,"primaryAsset":null}}
```

The mapping the shipped page applies (`productJsonLd` in `apps/storefront/src/lib/seo.ts`, called from the product page):

- `name`: `data.name`, already resolved to the locale.
- `description`: `data.description` with the tags stripped (the field is operator rich text; Schema.org wants plain text), falling back to `name` when empty.
- `image`: the primary asset's URL made absolute, else the first asset by `sortOrder`, else the storefront's own `/brand/no-image.svg`; always a one-element array. This product has no asset, so the fallback applies.
- `sku`: the first variant's `sku`; `brand`: `data.brand` as a `Brand`, omitted when `null`, as here.
- `offers.price`: the first variant's `price` printed with the store's fraction digits (two for EUR, three for a three-decimal currency; never a literal `2`); `offers.priceCurrency`: `data.currency` when the response carries one, else the store's currency code; `offers.availability`: `InStock` unless every variant is `OUT_OF_STOCK`; `offers.url`: the canonical product URL.
- `aggregateRating` and `review`: from the reviews summary and the first three attributable reviews, omitted when there are none.
- `itemCondition`: always `https://schema.org/NewCondition`.

Applied to the response above, with `STOREFRONT_PUBLIC_BASE_URL=https://shop.example`, the page emits:

```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Northwind Compact 12 SE Laptop",
  "description": "Crafted for daily productivity: long battery life, a quiet keyboard, and a clear display tuned for bright daylight. The Northwind Compact 12 SE ships with a one-year warranty and a full keyboard.",
  "image": ["https://shop.example/brand/no-image.svg"],
  "itemCondition": "https://schema.org/NewCondition",
  "offers": {
    "@type": "Offer",
    "url": "https://shop.example/en/catalog/product/fx-laptop-compact-12-se",
    "priceCurrency": "EUR",
    "price": "1299.00",
    "availability": "https://schema.org/InStock"
  },
  "sku": "FX-LAP-CPT12-SE"
}
```

and, on the same page, the breadcrumb (its `name` values are the page's own breadcrumb labels: the home link, the first category, the product) and the head links:

```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://shop.example/en/" },
    { "@type": "ListItem", "position": 2, "name": "Electronics", "item": "https://shop.example/en/catalog/fx-electronics" },
    { "@type": "ListItem", "position": 3, "name": "Northwind Compact 12 SE Laptop", "item": "https://shop.example/en/catalog/product/fx-laptop-compact-12-se" }
  ]
}
```

```html
<html lang="en" dir="ltr">
<link rel="canonical" href="https://shop.example/en/catalog/product/fx-laptop-compact-12-se">
<link rel="alternate" hreflang="en-FR" href="https://shop.example/en/catalog/product/fx-laptop-compact-12-se">
<link rel="alternate" hreflang="fr-FR" href="https://shop.example/fr/catalog/product/fx-laptop-compact-12-se">
<link rel="alternate" hreflang="x-default" href="https://shop.example/en/catalog/product/fx-laptop-compact-12-se">
<meta property="og:locale" content="en_FR">
<meta property="og:locale:alternate" content="fr_FR">
<meta property="product:price:amount" content="1299.00">
<meta property="product:price:currency" content="EUR">
<meta property="product:availability" content="in stock">
```

`en-FR` and `x-default` match the sitemap entries for the same product above, which is the whole point: the crawler reads one set of alternates in the sitemap and the same set in the page.

## Error codes

These routes answer text or XML on success and the standard envelope on failure ([Error codes](../reference/error-codes.md)).

- `NOT_FOUND` (404): a path that is not one of the surfaces, for example a sitemap name the engine does not build. Proxy only the named paths; do not forward an arbitrary `*.xml` request upstream.
- `RATE_LIMITED` (429): the storefront read limiter, on every surface and on `GET /v1/seo/redirects`. Cache each surface on your side (the shipped storefront answers `s-maxage=3600` on the sitemaps and `robots.txt`, `s-maxage=21600` on the `llms` files, and keeps the redirect table for five minutes) so a crawl never fans out into one API call per request.
- Any non-`200` from the API on a proxied surface: the shipped proxy answers `502` with a one-line body rather than an empty sitemap, so a crawler retries instead of dropping every URL. A failed redirect fetch fails open: the page renders as if no row matched.

Proof, an unknown sitemap name:

```http
HTTP/1.1 404 Not Found
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
```

```json
{"error":{"code":"NOT_FOUND","message":"Cannot GET /api/v1/sitemap-orders.xml","details":{"message":"Cannot GET /api/v1/sitemap-orders.xml","error":"Not Found","statusCode":404}}}
```

`details` appears because the engine ran in development; production strips it.

## Every locale

The sitemap carries every enabled locale at once (two in this example), so there is nothing to switch: each product, category and page has one `<url>` per locale and the same three `xhtml:link` alternates on each, as the two entries of `fx-laptop-compact-12-se` above show (`/en/...` and `/fr/...`, each with `en-FR`, `fr-FR` and `x-default`). `robots.txt` and the redirects are locale-free.

The two `llms` files are the ones that change. `GET /v1/llms.txt` under `Accept-Language: fr`, the head:

```http
HTTP/1.1 200 OK
Cache-Control: public, max-age=3600
Vary: Accept-Language
Content-Type: text/plain; charset=utf-8
```

```text
# Boutique Démo

> Une boutique de démonstration pour themerchantengine.

## About

- [About](http://localhost:53300/fr/about)
```

Against the English head above: the store name and description are the French values, and every URL takes the `/fr/` prefix. `GET /v1/llms-full.txt` under `fr` opens the same way (`# Boutique Démo`, then `## Categories` with each category's French name and description). The `Vary: Accept-Language` header is what keeps a shared cache from serving one language's file to the other; your proxy must forward the header upstream and repeat `Vary` downstream.

On the page side, the French product page emits the same JSON-LD with `name` and `description` from the `fr` response (`"Ordinateur portable Northwind Compact 12 SE"`, run transcript), the canonical at `/fr/catalog/product/...`, `og:locale` `fr_FR`, and `lang="fr"`. `dir` stays `ltr` on the `demo` fixture; a store with a right-to-left locale flips it from the store config's direction for that locale.

## Framework notes

- Next.js: `metadata` (static) or `generateMetadata` (per product, from the product fetch) fills `title`, `description`, `alternates.canonical` and `alternates.languages` (the `hreflang` map, `x-default` included) and `openGraph.locale`; JSON-LD is a `<script type="application/ld+json">` you render in the page with `JSON.stringify` and `</script` escaped. The proxies are route handlers: `app/sitemap_index.xml/route.ts`, `app/robots.txt/route.ts`, `app/llms.txt/route.ts` and the three sitemaps, each returning `new Response(body, { headers })` with the upstream content type; do not use the framework's `sitemap.ts` generator, its output would not match the IndexNow URLs.
- Nuxt: `useSeoMeta` for the tags and `useHead` for `link` (canonical and the `hreflang` set), `htmlAttrs.lang` and `htmlAttrs.dir`, and the JSON-LD script; the proxies are `server/routes/sitemap_index.xml.get.ts` and friends, `defineEventHandler` fetching the API and setting `Content-Type` with `setResponseHeader`.
- SvelteKit: `<svelte:head>` in `+page.svelte` for the tags, the links and the JSON-LD script, `lang` and `dir` on `<html>` from `hooks.server.ts` (`transformPageChunk`); the proxies are `src/routes/sitemap_index.xml/+server.ts` and friends returning a `Response` with the upstream body.
- In all three the redirect check is server middleware that runs before the router (Next.js `middleware.ts`, a Nuxt server middleware, SvelteKit `handle` in `hooks.server.ts`), and the `llms` proxies forward `Accept-Language` and answer `Vary`.

Base URL, cookie forwarding and the `304` rule in the long form: [Framework notes](./framework-notes.md#proxy-routes-for-the-seo-files).
