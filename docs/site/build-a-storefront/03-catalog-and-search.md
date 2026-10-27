---
title: Catalog and search
description: "The category tree, the product list with its filters, sort allowlist and pagination, the product detail, brand and specification facets, full-text search, suggestions and search filters, with the product shape a storefront renders, the asset variants it picks for srcset, and the same responses under both locales."
primaryQuery: ecommerce api product list category tree search suggest pagination srcset accept-language
updated: 2026-09-09
schema: TechArticle
---

This step gives a storefront everything it lists, filters and searches: the category tree, product pages, product detail, the facets for a filter rail, full-text search and type-ahead suggestions. Every route here is public and read-only, so there is no cookie to carry; what the storefront owes the engine is the `Accept-Language` header on every call and the paging rule below. That serves the locale obligation of [the contract](./index.md#the-ten-obligations). The locale rules themselves are on the [conventions page](../customize/conventions.md#translatable-text-and-locale-resolution) and are not repeated here.

Every response on this page was pasted from a run against a local engine serving the `demo` fixture (English default, French second, EUR, prices shown TTC) and its fixture catalogue. Two things were changed in the pasted bodies and nothing else: the asset host was replaced by `https://assets.shop.example`, and a long list is cut after its first entries with a `// ...` comment that says so.

## The request

Base: `https://api.shop.example/api/v1`. All routes are `GET`, take no cookie, and answer `Cache-Control: no-store` (verified with a header dump, below), so a storefront caches them itself or not at all.

- `GET /v1/categories`: the whole visible tree, nested under `children`.
- `GET /v1/categories/{slug}`: one category with its `productCount`.
- `GET /v1/categories/{slug}/products?page=&pageSize=`: the products under that category, paginated. Both query parameters are optional (the generated reference marks them required; the controller in `apps/api/src/modules/categories/categories.controller.ts` defaults them).
- `GET /v1/products`: the active catalogue, filtered, sorted and paginated.
- `GET /v1/products/{slug}`: the product detail.
- `GET /v1/products/brands?categoryId=`: brand facets with counts over the whole active catalogue, optionally scoped to one category.
- `GET /v1/products/spec-facets`: the specification facets a filter rail offers.
- `GET /v1/search?q=`: full-text search, paginated, with its own filter set.
- `GET /v1/search/suggest?q=`: up to eight type-ahead entries, products and categories.
- `GET /v1/search/filters?q=`: the brand and category buckets of a result set.

The full parameter lists are on the generated pages for [categories](../reference/storefront-api/categories.md), [products](../reference/storefront-api/products.md) and [search](../reference/storefront-api/search.md).

### Headers that matter

- `Accept-Language: en` or `fr`. Every `Translatable` field comes back as one string in that locale. From a browser page that cannot set `Accept-Language`, send `X-Locale` instead; it wins when both are present.
- No cookie, no idempotency key. These routes are `@Public()`.

### Query parameters of `GET /v1/products`

The DTO is `ListProductsStorefrontDto` in `apps/api/src/modules/products/dto/query-products.dto.ts`.

- `page` (default 1) and `pageSize` (default 20, maximum 100; 101 is a 400).
- `sortBy`: one of `sortOrder`, `publishedAt`, `createdAt`, `price`, `name`, the allowlist `VALID_STOREFRONT_SORT_FIELDS` in `apps/api/src/modules/products/products.constants.ts`. Anything else silently falls back to `sortOrder`; it is never interpolated. `price` and `name` are computed in the service (the price lives on the variant, the name is per locale), so `name` sorts on the string the customer reads in the requested locale.
- `sortOrder`: `asc` (default) or `desc`.
- `categoryId`, `brand`, `isFeatured`, `ids` (comma-separated, at most 100, order not preserved).
- `tags`: comma-separated `facet:value` tokens. Values within one facet are OR-ed, facets are AND-ed. Anything that is not `[a-z0-9-]+:[a-z0-9-]+` is a 400.
- `specs`: comma-separated `key:valueKey` tokens from `spec-facets`, same OR-within, AND-across rule.
- `minPrice`, `maxPrice`: money with at most the store's decimal places; a product matches when one active variant's price is in range.

### Query parameters of `GET /v1/search`

The DTO is `SearchProductsDto` in `apps/api/src/modules/search/dto/search-products.dto.ts`.

- `q`: up to 200 characters; empty searches the whole catalogue.
- `categoryId`, `brand`, `priceMin`, `priceMax`, `inStock`, `rating` (1 to 5).
- `sortBy`: `relevance`, `price`, `rating`, `createdAt` or `name`; `sortOrder`; `page`; `pageSize` (default 20, maximum 100). The generated search page does not list `sortBy` and `sortOrder`; the DTO accepts them.

### A framework-neutral fetch

```js
const API = 'https://api.shop.example/api/v1';

export async function listProducts(locale, query = {}, page = 1) {
  const params = new URLSearchParams({ ...query, page: String(page), pageSize: '24' });
  const res = await fetch(`${API}/products?${params}`, {
    headers: { Accept: 'application/json', 'Accept-Language': locale },
    // credentials: 'include' is only needed on routes that read a cookie; harmless here.
  });
  if (res.status === 304) return null; // never expected, but never an error
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.error.code), body.error);
  return body; // { data, meta }
}
```

The same function serves `/categories/{slug}/products` and `/search` once the path changes; the envelope and `meta` are the same shape.

## The response

### The category tree

`GET /v1/categories` under `Accept-Language: en`, one root kept out of fifteen. `metaTitle` is elided because on this fixture its value contains a character this page may not print; it is a plain string like `name`:

```json
{
  "data": [
    {
      "id": "cmtub34dg0001wcqs8bz1tsuw",
      "name": "Audio",
      "slug": "fx-audio",
      "description": "Headphones and listening gear tuned for clear, immersive sound at home or on the go.",
      "parentId": null,
      "imageId": "f39c48ed-0488-5b81-8be5-a153227bf56e",
      "sortOrder": 1,
      "isVisible": true,
      "path": "/cmtub34dg0001wcqs8bz1tsuw",
      "depth": 0,
      // metaTitle omitted: its value carries a character this page may not print
      "metaDescription": "Premium headphones, earbuds, and speakers shipped fast.",
      "createdAt": "2026-09-09T16:21:44.548Z",
      "updatedAt": "2026-09-09T16:21:44.557Z",
      "deletedAt": null,
      "imageUrl": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/small.webp",
      "imageVariants": [
        {
          "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.webp",
          "width": 150,
          "format": "webp"
        },
        {
          "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.avif",
          "width": 150,
          "format": "avif"
        },
        // ... 6 more entries: medium and large in webp and avif
      ],
      "children": [
        {
          "id": "cmtub34o70005wcqsruokngxg",
          "name": "Pro Headphones",
          "slug": "fx-pro-headphones",
          "description": "Studio-grade headphones for honest, reference-quality sound.",
          "parentId": "cmtub34dg0001wcqs8bz1tsuw",
          "imageId": "f39c48ed-0488-5b81-8be5-a153227bf56e",
          "sortOrder": 0,
          "isVisible": true,
          "path": "/cmtub34dg0001wcqs8bz1tsuw/cmtub34o70005wcqsruokngxg",
          "depth": 1,
          // metaTitle omitted: its value carries a character this page may not print
          "metaDescription": "Reference studio headphones tuned for clear, accurate sound.",
          "createdAt": "2026-09-09T16:21:44.935Z",
          "updatedAt": "2026-09-09T16:21:44.946Z",
          "deletedAt": null,
          "imageUrl": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/small.webp",
          "imageVariants": [
            {
              "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.webp",
              "width": 150,
              "format": "webp"
            },
            {
              "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.avif",
              "width": 150,
              "format": "avif"
            },
            {
              "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/small.webp",
              "width": 400,
              "format": "webp"
            },
            {
              "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/small.avif",
              "width": 400,
              "format": "avif"
            },
            {
              "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/medium.webp",
              "width": 800,
              "format": "webp"
            },
            {
              "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/medium.avif",
              "width": 800,
              "format": "avif"
            },
            {
              "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/large.webp",
              "width": 1200,
              "format": "webp"
            },
            {
              "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/large.avif",
              "width": 1200,
              "format": "avif"
            }
          ],
          "children": []
        },
        {
          "id": "cmtub34ot0006wcqscb5nolfa",
          "name": "Wireless Headphones",
          "slug": "fx-wireless-headphones",
          "description": "Cable-free over-ear headphones with all-day battery and active noise cancellation.",
          "parentId": "cmtub34dg0001wcqs8bz1tsuw",
          "imageId": "f39c48ed-0488-5b81-8be5-a153227bf56e",
          "sortOrder": 1,
          "isVisible": true,
          "path": "/cmtub34dg0001wcqs8bz1tsuw/cmtub34ot0006wcqscb5nolfa",
          "depth": 1,
          // metaTitle omitted: its value carries a character this page may not print
          "metaDescription": "Wireless over-ear headphones with active noise cancellation.",
          "createdAt": "2026-09-09T16:21:44.957Z",
          "updatedAt": "2026-09-09T16:21:44.967Z",
          "deletedAt": null,
          "imageUrl": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/small.webp",
          "imageVariants": [
            // ... the same 8 entries as the sibling above
          ],
          "children": []
        }
      ]
    },
    // ... 14 more root categories of this store, each with the same shape
  ]
}
```

What a storefront renders: `name` and `description` (already one string each), `slug` for the link, `children` for the nav, `sortOrder` for the order, `imageUrl` plus `imageVariants` when a category has an image (the same ladder as a product asset, below). `path` is the ancestor id chain and `depth` its length; a breadcrumb walks the tree with them. Hidden categories are not in the tree and answer 404 by slug. The tree is cached server-side for one hour.

### One category and its products

`GET /v1/categories/fx-audio`:

```json
{
  "data": {
    "id": "cmtub34dg0001wcqs8bz1tsuw",
    "name": "Audio",
    "slug": "fx-audio",
    "description": "Headphones and listening gear tuned for clear, immersive sound at home or on the go.",
    "parentId": null,
    "imageId": "f39c48ed-0488-5b81-8be5-a153227bf56e",
    "sortOrder": 1,
    "isVisible": true,
    "path": "/cmtub34dg0001wcqs8bz1tsuw",
    "depth": 0,
    // metaTitle omitted: its value carries a character this page may not print
    "metaDescription": "Premium headphones, earbuds, and speakers shipped fast.",
    "createdAt": "2026-09-09T16:21:44.548Z",
    "updatedAt": "2026-09-09T16:21:44.557Z",
    "deletedAt": null,
    "imageUrl": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/small.webp",
    "imageVariants": [
      {
        "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.webp",
        "width": 150,
        "format": "webp"
      },
      {
        "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.avif",
        "width": 150,
        "format": "avif"
      },
      // ... 6 more entries: medium and large in webp and avif
    ],
    "children": [],
    "productCount": 8
  }
}
```

`productCount` counts the products attached to the category itself and its subtree, and `GET /v1/categories/fx-audio/products?pageSize=2` pages through the same eight:

```json
{
  "data": [
    {
      "id": "cmtub35cd000rwcqsegpwwjsf",
      "name": "Studio Reference Studio Headphones",
      "slug": "fx-pro-headphones-studio-reference",
      "shortDescription": "Reference-grade studio reference headphones for clear, honest sound.",
      "status": "ACTIVE",
      "brand": "Northwind Studio",
      "tags": [
        "headphones",
        "studio",
        "cod-eligible",
        "featured",
        "bestseller",
        "new-arrival"
      ],
      "isFeatured": true,
      "sortOrder": 0,
      "publishedAt": "2026-09-09T16:21:45.802Z",
      // assets: the raw asset rows; render from primaryAsset instead
      "variants": [
        {
          "id": "cmtub35cj000swcqs37szmr58",
          "sku": "FX-AUD-PRO-REF",
          "price": 1199,
          "compareAtPrice": null,
          "isDefault": true
        }
      ],
      "primaryAsset": {
        "id": "f39c48ed-0488-5b81-8be5-a153227bf56e",
        "assetId": "f39c48ed-0488-5b81-8be5-a153227bf56e",
        "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/small.webp",
        "type": "IMAGE",
        "altText": "Audio",
        "isPrimary": true,
        "sortOrder": 0,
        "assetVariants": [
          {
            "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.webp",
            "width": 150,
            "format": "webp"
          },
          {
            "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.avif",
            "width": 150,
            "format": "avif"
          },
          // ... 6 more entries: medium and large in webp and avif
        ]
      }
    },
    {
      "id": "cmtub35dd000twcqsl08wcshr",
      "name": "Studio Reference Pro Studio Headphones",
      "slug": "fx-pro-headphones-studio-reference-pro",
      "shortDescription": "Reference-grade studio reference pro headphones for clear, honest sound.",
      "status": "ACTIVE",
      "brand": "Northwind Studio",
      "tags": [
        "headphones",
        "studio",
        "cod-eligible",
        "bestseller",
        "new-arrival"
      ],
      "isFeatured": false,
      "sortOrder": 0,
      "publishedAt": "2026-09-09T16:21:45.837Z",
      // assets: the raw asset rows; render from primaryAsset instead
      "variants": [
        {
          "id": "cmtub35dk000uwcqsgf8k6qat",
          "sku": "FX-AUD-PRO-REFPRO",
          "price": 1499,
          "compareAtPrice": 1699,
          "isDefault": true
        }
      ],
      "primaryAsset": {
        "id": "f39c48ed-0488-5b81-8be5-a153227bf56e",
        "assetId": "f39c48ed-0488-5b81-8be5-a153227bf56e",
        "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/small.webp",
        "type": "IMAGE",
        "altText": "Audio",
        "isPrimary": true,
        "sortOrder": 0,
        "assetVariants": [
          {
            "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.webp",
            "width": 150,
            "format": "webp"
          },
          {
            "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.avif",
            "width": 150,
            "format": "avif"
          },
          // ... 6 more entries: medium and large in webp and avif
        ]
      }
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 2,
    "total": 8,
    "totalPages": 4
  }
}
```

One difference from `GET /v1/products` is visible in that paste: the variants under a category page carry no `availability`. The catalogue list and the product detail grade stock; this route does not. A storefront that shows stock on category cards reads them from `GET /v1/products?categoryId=` instead, which also takes the sort and the filters.

### The product list

`GET /v1/products?categoryId=cmtub34dg0001wcqs8bz1tsuw&pageSize=2` under `Accept-Language: en`, first item in full, with the header dump that shows the cache policy:

```http
HTTP/1.1 200 OK
Cache-Control: no-store
Vary: Origin
X-Request-Id: 6b170da4-bac5-41a1-866e-80a072187d37
Content-Type: application/json; charset=utf-8
Content-Length: 9663
```

```json
{
  "data": [
    {
      "id": "cmtub35dd000twcqsl08wcshr",
      "name": "Studio Reference Pro Studio Headphones",
      "slug": "fx-pro-headphones-studio-reference-pro",
      "shortDescription": "Reference-grade studio reference pro headphones for clear, honest sound.",
      "status": "ACTIVE",
      "brand": "Northwind Studio",
      "tags": [
        "headphones",
        "studio",
        "cod-eligible",
        "bestseller",
        "new-arrival"
      ],
      "isFeatured": false,
      "sortOrder": 0,
      "publishedAt": "2026-09-09T16:21:45.837Z",
      "assets": [
        {
          "assetId": "f39c48ed-0488-5b81-8be5-a153227bf56e",
          "sortOrder": 0,
          "isPrimary": true,
          "asset": {
            "id": "f39c48ed-0488-5b81-8be5-a153227bf56e",
            "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/large.webp",
            "type": "IMAGE",
            "alt": "Audio",
            "status": "READY",
            "variants": {
              "thumbnail": {
                "avif": {
                  "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.avif",
                  "size": 793,
                  "width": 150,
                  "height": 113,
                  "storagePath": "assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.avif"
                },
                "webp": {
                  "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.webp",
                  "size": 376,
                  "width": 150,
                  "height": 113,
                  "storagePath": "assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.webp"
                }
              },
              // the other variant entries of this asset: small, medium, large
            }
          }
        }
      ],
      "variants": [
        {
          "id": "cmtub35dk000uwcqsgf8k6qat",
          "sku": "FX-AUD-PRO-REFPRO",
          "price": 1499,
          "compareAtPrice": 1699,
          "isDefault": true,
          "availability": "IN_STOCK"
        }
      ],
      "primaryAsset": {
        "id": "f39c48ed-0488-5b81-8be5-a153227bf56e",
        "assetId": "f39c48ed-0488-5b81-8be5-a153227bf56e",
        "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/small.webp",
        "type": "IMAGE",
        "altText": "Audio",
        "isPrimary": true,
        "sortOrder": 0,
        "assetVariants": [
          {
            "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.webp",
            "width": 150,
            "format": "webp"
          },
          {
            "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.avif",
            "width": 150,
            "format": "avif"
          },
          // ... 6 more entries: medium and large in webp and avif
        ]
      }
    },
    {
      "id": "cmtub35cd000rwcqsegpwwjsf",
      "name": "Studio Reference Studio Headphones",
      "slug": "fx-pro-headphones-studio-reference",
      // the other product fields, unchanged
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 2,
    "total": 8,
    "totalPages": 4
  }
}
```

### The product shape a card renders

- `name` and `shortDescription` are single strings, resolved from the `Translatable` object by `Accept-Language`. Nothing else in the storefront resolves a locale.
- `variants[]` is the list of active variants, the default one first (`isDefault: true`, then cheapest). The card shows `variants[0]`. Each carries `id` (what the cart takes), `sku`, `price`, `compareAtPrice` and `availability`.
- The display price is `variants[0].price`, a plain number in the store's currency, here EUR with two decimals (`1499` renders as `1 499,00 €` on this fixture). The store config's `money.taxDisplay` (`TTC` on this fixture) is the mention the storefront prints beside it; the number itself does not change with that setting. Formatting rules and the config are on [config, locale and money](./01-config-locale-money.md) and in the [store config reference](../reference/store-config.md). `compareAtPrice` is `null`, or the struck-through price when a variant is on offer: the first item above sells at `1499` against `1699`.
- `availability` is a three-state grade, never a count: `IN_STOCK`, `LOW_STOCK` (net stock at or below the store's low-stock threshold, ten by default; see `apps/api/src/modules/inventory/inventory.constants.ts`) or `OUT_OF_STOCK`. The exact quantity stays server-side because these routes are anonymous.
- `tags` are plain tokens; a card can render some of them as chips. The `tags=` filter expects the `facet:value` form, so only tags written that way filter.
- `primaryAsset` is what the image comes from (below). `assets[]` on the list is the raw junction row with the whole variant object of the storage layer; render from `primaryAsset` and ignore `assets` on cards.
- `brand`, `isFeatured`, `publishedAt` and `sortOrder` are plain values.

### Asset variants and srcset

Every image asset exists in four widths and two formats, written by the image processor when the asset reaches `READY`: `thumbnail` 150 px, `small` 400 px, `medium` 800 px and `large` 1200 px, each as `webp` and `avif`. The names and widths are in `libs/shared/common/src/asset-variants/asset-variants.schema.ts` and `libs/shared/common/src/asset-variants/image-variants.ts`; the wire shape of one entry is the Zod schema in `libs/storefront-types/src/lib/shared/asset-variants.ts` (`url`, `width`, `format`).

The API picks the canonical variant for the intent of the route (`libs/shared/common/src/asset-variants/resolver.ts`): `primaryAsset.url` on a list is the `card` intent, the 400 px webp; on the product detail it is the `detail` intent, the 1200 px webp. `assetVariants` carries the whole ladder, eight entries, whatever the intent. Every URL is absolute and is served by the asset store directly, not through the API, so `<img>` needs no credentials and no proxy.

To build a `<picture>`, group the entries by `format`, put the `avif` source first, then `webp`, then the `url` as the `<img>` fallback:

```js
export function pictureSources(assetVariants, sizes) {
  const byFormat = { avif: [], webp: [] };
  for (const v of assetVariants) byFormat[v.format]?.push(`${v.url} ${v.width}w`);
  return ['avif', 'webp']
    .filter((f) => byFormat[f].length)
    .map((f) => ({ type: `image/${f}`, srcset: byFormat[f].join(', '), sizes }));
}
```

That is what `pictureSourcesFromAssetVariants` in `apps/storefront/src/lib/asset-variant.ts` does. When an asset is still processing or failed, `url` is an empty string and `assetVariants` is `[]`; render a placeholder, never the empty URL.

### Sort and filters, proven

`GET /v1/products?categoryId=cmtub34dg0001wcqs8bz1tsuw&sortBy=price&sortOrder=asc&pageSize=3` (only the fields that prove the order are kept):

```json
{
  "data": [
    {
      "slug": "fx-wl-headphones-active-sport",
      // the other product fields, unchanged
      "variants": [
        {
          "price": 449,
          "availability": "IN_STOCK"
        }
      ]
    },
    {
      "slug": "fx-wl-headphones-daily-commute",
      // the other product fields, unchanged
      "variants": [
        {
          "price": 549,
          "availability": "IN_STOCK"
        }
      ]
    },
    {
      "slug": "fx-wl-headphones-quiet-travel",
      // the other product fields, unchanged
      "variants": [
        {
          "price": 849,
          "availability": "IN_STOCK"
        }
      ]
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 3,
    "total": 8,
    "totalPages": 3
  }
}
```

`GET /v1/products?brand=Northwind%20Motion&pageSize=2` narrows `total` to the brand:

```json
{
  "data": [
    {
      "slug": "fx-wl-headphones-quiet-travel",
      "brand": "Northwind Motion",
      // the other product fields, unchanged
    },
    {
      "slug": "fx-wl-headphones-quiet-travel-plus",
      "brand": "Northwind Motion",
      // the other product fields, unchanged
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 2,
    "total": 4,
    "totalPages": 2
  }
}
```

`GET /v1/products?categoryId=cmtub34dg0001wcqs8bz1tsuw&sortBy=bogus&pageSize=1` is not an error; it is the default order:

```json
{
  "data": [
    {
      "slug": "fx-pro-headphones-studio-reference",
      "sortOrder": 0,
      // the other product fields, unchanged
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 1,
    "total": 8,
    "totalPages": 8
  }
}
```

### Brand and specification facets

`GET /v1/products/brands?categoryId=cmtub34dg0001wcqs8bz1tsuw` is computed over the whole active catalogue of that scope, not over the current page, so a selected brand does not collapse the list to itself:

```json
{
  "data": [
    {
      "brand": "Northwind Motion",
      "count": 4
    },
    {
      "brand": "Northwind Studio",
      "count": 4
    }
  ]
}
```

`GET /v1/products/spec-facets` under `Accept-Language: en`, first facet kept. `label` and `value` are translated, `key` and `valueKey` are what goes back in `specs=`. The fixture catalogue carries no specification rows, so the facets below come from the rest of this store's catalogue:

```json
{
  "data": [
    {
      "key": "certification",
      "label": "Certification",
      "coverage": 52,
      "values": [
        {
          "valueKey": "ce-iso",
          "value": "CE ISO",
          "count": 38
        },
        {
          "valueKey": "ce",
          "value": "CE",
          "count": 10
        },
        // ... more items, same shape
      ]
    },
    // ... more items, same shape
  ]
}
```

A facet only ships when it can narrow something: it has to cover enough products and at least two of its values have to hold two or more. Counts are catalogue-wide and do not move as the customer pages.

### The product detail

`GET /v1/products/fx-wl-headphones-daily-commute` under `Accept-Language: en`:

```json
{
  "data": {
    "id": "cmtub35jj0013wcqsxkysa45q",
    "name": "Daily Commute Wireless Headphones",
    "slug": "fx-wl-headphones-daily-commute",
    "description": "Active noise cancellation, quick-charge battery, and travel-friendly fold. The Daily Commute keeps your day quiet without ever feeling heavy on your head.",
    "shortDescription": "Comfortable wireless daily commute headphones with all-day battery.",
    "status": "ACTIVE",
    "productTypeId": null,
    "brand": "Northwind Motion",
    "brandId": null,
    "gtin": null,
    "mpn": null,
    "tags": [
      "headphones",
      "wireless",
      "cod-eligible",
      "bestseller"
    ],
    "isFeatured": false,
    "isDigital": false,
    "sortOrder": 0,
    "metaTitle": "Daily Commute Wireless Headphones",
    "metaDescription": "Daily Commute wireless headphones, shipped fast, cash on delivery available.",
    "publishedAt": "2026-09-09T16:21:46.062Z",
    "createdAt": "2026-09-09T16:21:46.063Z",
    "updatedAt": "2026-09-09T16:21:46.063Z",
    "deletedAt": null,
    "variants": [
      {
        "id": "cmtub35jt0014wcqswgyk5nwr",
        "productId": "cmtub35jj0013wcqsxkysa45q",
        "sku": "FX-AUD-WL-CMT",
        "price": 549,
        "compareAtPrice": null,
        "isDefault": true,
        "availability": "IN_STOCK"
      }
    ],
    "assets": [
      {
        "id": "93c115b7-ea80-5ece-bd7c-06bafa0002f5",
        "assetId": "93c115b7-ea80-5ece-bd7c-06bafa0002f5",
        "url": "https://assets.shop.example/assets/seed-fixture-catalogue/42cf68bc34696e40247ebac6f935193d/large.webp",
        "type": "IMAGE",
        "altText": "Electronics",
        "isPrimary": true,
        "sortOrder": 0,
        "assetVariants": [
          {
            "url": "https://assets.shop.example/assets/seed-fixture-catalogue/42cf68bc34696e40247ebac6f935193d/thumbnail.webp",
            "width": 150,
            "format": "webp"
          },
          {
            "url": "https://assets.shop.example/assets/seed-fixture-catalogue/42cf68bc34696e40247ebac6f935193d/thumbnail.avif",
            "width": 150,
            "format": "avif"
          },
          // ... 6 more entries: medium and large in webp and avif
        ]
      },
      // ... more assets, same shape
    ],
    "faqs": [],
    "specs": [],
    "categories": [
      {
        "productId": "cmtub35jj0013wcqsxkysa45q",
        "categoryId": "cmtub34dg0001wcqs8bz1tsuw",
        "category": {
          "id": "cmtub34dg0001wcqs8bz1tsuw",
          "name": "Audio",
          "slug": "fx-audio"
        }
      },
      {
        "productId": "cmtub35jj0013wcqsxkysa45q",
        "categoryId": "cmtub34ot0006wcqscb5nolfa",
        "category": {
          "id": "cmtub34ot0006wcqscb5nolfa",
          "name": "Wireless Headphones",
          "slug": "fx-wireless-headphones"
        }
      }
    ],
    "productType": null,
    "primaryAsset": {
      "id": "93c115b7-ea80-5ece-bd7c-06bafa0002f5",
      "assetId": "93c115b7-ea80-5ece-bd7c-06bafa0002f5",
      "url": "https://assets.shop.example/assets/seed-fixture-catalogue/42cf68bc34696e40247ebac6f935193d/large.webp",
      "type": "IMAGE",
      "altText": "Electronics",
      "isPrimary": true,
      "sortOrder": 0,
      "assetVariants": [
        {
          "url": "https://assets.shop.example/assets/seed-fixture-catalogue/42cf68bc34696e40247ebac6f935193d/thumbnail.webp",
          "width": 150,
          "format": "webp"
        },
        {
          "url": "https://assets.shop.example/assets/seed-fixture-catalogue/42cf68bc34696e40247ebac6f935193d/thumbnail.avif",
          "width": 150,
          "format": "avif"
        },
        // ... 6 more entries: medium and large in webp and avif
      ]
    }
  }
}
```

What the detail adds to the card shape:

- `description` is sanitised HTML (paragraphs, lists, headings up to `h4`, links). Render it as HTML; it was cleaned on write. `metaTitle` and `metaDescription` feed the `<head>`.
- `assets[]` here is the gallery, already flattened to the same shape as `primaryAsset`, in `sortOrder`, with `url` at the `detail` intent (1200 px).
- `specs[]` is the specification table, empty on this product; a row is `{ id, label, value, key, sortOrder }` with `label` and `value` in the request locale and `key` matching `spec-facets`.
- `faqs[]` is the question and answer list, empty here; an entry is `{ id, question, answer, sortOrder }`. Render it and emit it as FAQ structured data.
- `categories[]` gives the breadcrumb targets; hidden categories are filtered out so every link resolves. `productType` is `null` or `{ id, name, code }`.
- A variant carries `id`, `sku`, `price`, `compareAtPrice`, `isDefault` and `availability`, and nothing else: no cost, no barcode, no attribute values. The public detail has no attribute label, so the shipped storefront labels a variant by its `sku` (`apps/storefront/src/app/sections/product/product-summary.component.ts`). When the cart snapshots a line it builds a text label from the attribute values server-side; see [the cart page](./04-cart.md).
- The detail is cached for five minutes server-side, but `availability` is graded after the cache on every read, so a cached page never shows a stale stock state.

### Infinite scroll with `meta`

Every list answers `meta: { page, pageSize, total, totalPages }` (search omits `totalPages`). The rule the shipped storefront follows in `apps/storefront/src/app/pages/[locale]/catalog/index.page.ts`:

- Keep the loaded items and `total`. There is more when `items.length < meta.total`.
- Load more by requesting `page + 1` with exactly the same query (filters, sort, `pageSize`) and appending `data`. Never recompute the offset from the DOM.
- Replace `page` in the URL after each append so a reload lands on the same depth, and reset to page 1 whenever a filter or the sort changes.
- Ignore `totalPages` for the stop condition; `total` is what both routes share.

`GET /v1/products?categoryId=cmtub34dg0001wcqs8bz1tsuw&page=2&pageSize=2` is that second request for the list above: `page: 2`, the same `total: 8`, and `data` holding items 3 and 4:

```json
{
  "data": [
    {
      "id": "cmtub35eh000vwcqsogzl1p1v",
      "name": "Stage Monitor Studio Headphones",
      "slug": "fx-pro-headphones-stage-monitor",
      // the other product fields, unchanged
    },
    {
      "id": "cmtub35fl000xwcqso2ijdjgk",
      "name": "Producer Edition Studio Headphones",
      "slug": "fx-pro-headphones-producer-edition",
      // the other product fields, unchanged
    }
  ],
  "meta": {
    "page": 2,
    "pageSize": 2,
    "total": 8,
    "totalPages": 4
  }
}
```

### Search

`GET /v1/search?q=headphones&pageSize=2` under `Accept-Language: en`, first hit kept:

```json
{
  "data": [
    {
      "product": {
        "id": "cmtub35cd000rwcqsegpwwjsf",
        "name": "Studio Reference Studio Headphones",
        "slug": "fx-pro-headphones-studio-reference",
        "brand": "Northwind Studio",
        "tags": [
          "headphones",
          "studio",
          "cod-eligible",
          "featured",
          "bestseller",
          "new-arrival"
        ],
        "isFeatured": true,
        "createdAt": "2026-09-09T16:21:45.805Z",
        "minPrice": 1199,
        "avgRating": 4.5,
        "reviewCount": 8,
        "inStock": true,
        "availability": "IN_STOCK",
        "thumbnail": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.webp",
        "primaryAsset": {
          "id": "f39c48ed-0488-5b81-8be5-a153227bf56e",
          "assetId": "f39c48ed-0488-5b81-8be5-a153227bf56e",
          "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/small.webp",
          "altText": "Audio",
          "isPrimary": true,
          "assetVariants": [
            {
              "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.webp",
              "width": 150,
              "format": "webp"
            },
            {
              "url": "https://assets.shop.example/assets/seed-fixture-catalogue/631f9a396648fb57e38394af54581bb1/thumbnail.avif",
              "width": 150,
              "format": "avif"
            },
            // ... 6 more entries: medium and large in webp and avif
          ]
        },
        "categories": [
          {
            "id": "cmtub34dg0001wcqs8bz1tsuw",
            "name": "Audio"
          },
          {
            "id": "cmtub34o70005wcqsruokngxg",
            "name": "Pro Headphones"
          }
        ]
      },
      "eventId": "cmtub6o5b003p9sqsm4i6b6qj",
      "score": 6.217856854200363
    },
    // ... more hits, same shape
  ],
  "meta": {
    "page": 1,
    "pageSize": 2,
    "total": 8
  }
}
```

A search hit is not the list shape: it is `{ product, eventId, score }`, and `product` is the search projection (`minPrice` instead of `variants`, `avgRating` and `reviewCount`, `thumbnail`, `inStock` beside the three-state `availability`, category ids and names without slugs). `eventId` identifies the search event, the same id on every hit of one search; post it back to `/v1/search/events/{id}/click` when a customer opens a hit, which the [analytics page](./09-analytics-and-events.md) covers. A term that matches nothing is an empty page, not an error; `GET /v1/search?q=zzqxplorf`:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 0
  }
}
```

### Suggest and filters

`GET /v1/search/suggest?q=headph` under `Accept-Language: en`: at most eight entries, products and categories mixed, ordered by similarity, `label` in the request locale:

```json
{
  "data": [
    {
      "type": "category",
      "label": "Pro Headphones",
      "slug": "fx-pro-headphones"
    },
    {
      "type": "category",
      "label": "Wireless Headphones",
      "slug": "fx-wireless-headphones"
    },
    {
      "type": "product",
      "label": "Studio Reference Studio Headphones",
      "slug": "fx-pro-headphones-studio-reference"
    },
    {
      "type": "product",
      "label": "Stage Monitor Studio Headphones",
      "slug": "fx-pro-headphones-stage-monitor"
    },
    {
      "type": "product",
      "label": "Studio Reference Pro Studio Headphones",
      "slug": "fx-pro-headphones-studio-reference-pro"
    },
    {
      "type": "product",
      "label": "Active Sport Wireless Headphones",
      "slug": "fx-wl-headphones-active-sport"
    },
    {
      "type": "product",
      "label": "Quiet Travel Wireless Headphones",
      "slug": "fx-wl-headphones-quiet-travel"
    },
    {
      "type": "product",
      "label": "Daily Commute Wireless Headphones",
      "slug": "fx-wl-headphones-daily-commute"
    }
  ]
}
```

Suggestions use trigram similarity on the name, so a two-letter prefix returns `{ "data": [] }` (`q=la` did on this store); start suggesting from three or four characters. A term that matches nothing (`q=zzqxplorf`) is also `{ "data": [] }`. `q` is required, 1 to 100 characters; leaving it out is a 400 `VALIDATION_ERROR`.

`GET /v1/search/filters?q=headphones` buckets the result set. Brand values are names; category values are ids, which the storefront maps to names through the tree it already holds:

```json
{
  "data": [
    {
      "facet": "brand",
      "values": [
        {
          "value": "Northwind Studio",
          "count": 4
        },
        {
          "value": "Northwind Motion",
          "count": 4
        }
      ]
    },
    {
      "facet": "category",
      "values": [
        {
          "value": "cmtub34dg0001wcqs8bz1tsuw",
          "count": 8
        },
        {
          "value": "cmtub34o70005wcqsruokngxg",
          "count": 4
        },
        {
          "value": "cmtub34ot0006wcqscb5nolfa",
          "count": 4
        }
      ]
    }
  ]
}
```

## Error codes

Every code is in the [error code reference](../reference/error-codes.md). The `message` is English whatever the locale; the storefront maps `code` to its own catalogue.

- `CATEGORY_NOT_FOUND`, 404: `GET /v1/categories/{slug}` and `/{slug}/products` for a slug that does not exist or is hidden. Render the not-found page with a real 404 status.
- `PRODUCT_NOT_FOUND`, 404: `GET /v1/products/{slug}` for a slug that does not exist or is not `ACTIVE`. Same treatment; a product that was archived after being indexed must 404, not soft-fail.
- `VALIDATION_ERROR`, 400: a query parameter outside its rule on `/v1/products` (`pageSize` above 100, a bad `tags` or `specs` token, a negative price), on `/v1/search` or on `/v1/search/suggest` (missing `q`). `details[]` names the field. A storefront builds these from its own controls, so treat one as a bug and fall back to the unfiltered list; never show `messages` to the customer.
- `RATE_LIMITED`, 429: the read routes allow 100 requests a minute per client. Back off on `Retry-After`.

Proof, `GET /v1/products/no-such-product`:

```json
{
  "error": {
    "code": "PRODUCT_NOT_FOUND",
    "message": "Product not found"
  }
}
```

`GET /v1/categories/no-such-category`:

```json
{
  "error": {
    "code": "CATEGORY_NOT_FOUND",
    "message": "Category not found"
  }
}
```

`GET /v1/products?tags=not%20a%20token`:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "tags",
        "messages": [
          "tags must be a comma-separated list of facet:value tokens"
        ]
      }
    ]
  }
}
```

`GET /v1/products?pageSize=101`:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "pageSize",
        "messages": [
          "pageSize must not be greater than 100"
        ]
      }
    ]
  }
}
```

A bad `sortBy` is not on this list on purpose: it falls back to the default order (proven above).

## Every locale

The same requests under `Accept-Language: fr`. Ids, slugs, prices, tags, dates and URLs are identical; only the resolved strings change. This store has no RTL locale, so direction never enters a response; a store with one exposes it in `localization.rtlLocales` of the config, not per entity.

`GET /v1/categories/fx-audio`, the lines that differ from the English paste:

```json
{
  "description": "Casques et matériel audio réglés pour un son net et immersif, à la maison comme en déplacement.",
  "metaTitle": "Audio, Northwind",
  "metaDescription": "Casques, écouteurs et enceintes haut de gamme, expédiés rapidement."
}
```

In the tree the same happens to every `name`, `description`, `metaTitle` and `metaDescription`: `Pro Headphones` became `Casques professionnels`, `Wireless Headphones` became `Casques sans fil`.

`GET /v1/products?categoryId=cmtub34dg0001wcqs8bz1tsuw&pageSize=2`, the lines that differ:

```json
{
  "name": "Casque studio Studio Reference Pro",
  "shortDescription": "Casque Studio Reference Pro de niveau référence, pour un son net et fidèle."
}
```

`price: 1499`, `compareAtPrice: 1699`, `meta` and every URL are byte-identical. Money is a number in both locales; the storefront formats it (`1 499,00 €` on this fixture). The second item's `name` became `Casque studio Studio Reference`. The `altText` of this asset read `Audio` under both locales: an alt text is a `Translatable` like any other, and when a locale key is missing the interceptor falls back to the store default, then to `default`.

`GET /v1/products/fx-wl-headphones-daily-commute`, the lines that differ:

```json
{
  "name": "Casque sans fil Daily Commute",
  "description": "Réduction de bruit active, batterie à charge rapide et pliage adapté au voyage. Le Daily Commute garde votre journée au calme sans jamais peser sur la tête.",
  "shortDescription": "Casque sans fil Daily Commute confortable, avec une autonomie sur toute la journée.",
  "metaTitle": "Casque sans fil Daily Commute",
  "metaDescription": "Casque sans fil Daily Commute, expédition rapide et paiement à la livraison.",
  "altText": "Électronique",
  "categories": [
    { "category": { "name": "Audio" } },
    { "category": { "name": "Casques sans fil" } }
  ]
}
```

So on the detail, the product name, both descriptions, the meta fields, the category names and the alt texts follow the locale; `sku`, `price`, `slug` and the tags do not.

Search matches on every locale's text at once and labels in the requested one. `GET /v1/search?q=casque&pageSize=2` under `fr`:

```json
{
  "data": [
    {
      "product": {
        "id": "cmtub35jj0013wcqsxkysa45q",
        "name": "Casque sans fil Daily Commute",
        "slug": "fx-wl-headphones-daily-commute",
        // the other product fields, unchanged
      },
      "eventId": "cmtub6oxj003q9sqsurkms2wd",
      "score": 2.807499952428043
    },
    {
      "product": {
        "id": "cmtub35fl000xwcqso2ijdjgk",
        "name": "Casque studio Producer Edition",
        "slug": "fx-pro-headphones-producer-edition",
        // the other product fields, unchanged
      },
      "eventId": "cmtub6oxj003q9sqsurkms2wd",
      "score": 2.799999952316284
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 2,
    "total": 8
  }
}
```

The English term under the French locale (`q=headphones`, `Accept-Language: fr`) finds the same eight products with the same scores as under `en`, and names them in French (`Casque studio Studio Reference`). `GET /v1/search/suggest?q=casque` under `fr` answers the same eight entries as `q=headph` under `en`, labelled in French:

```json
{
  "data": [
    {
      "type": "category",
      "label": "Casques sans fil",
      "slug": "fx-wireless-headphones"
    },
    {
      "type": "product",
      "label": "Casque studio Studio Reference",
      "slug": "fx-pro-headphones-studio-reference"
    },
    // ... 6 more entries, same shape
  ]
}
```

## Framework notes

- Next.js, Nuxt and SvelteKit: fetch these routes in the server loader with `Accept-Language` set from the route's locale segment, never from the incoming browser header alone, or a French URL renders English on a cache miss.
- No cookie is needed here, so a server-side cache is safe: key it on locale plus the full query string, and let `Cache-Control: no-store` from the API stop the platform's fetch cache from doing it for you (`fetch(url, { cache: 'no-store' })` in Next.js).
- A 404 from `/v1/products/{slug}` or `/v1/categories/{slug}` becomes a real 404 page (`notFound()` in Next.js, `createError({ statusCode: 404 })` in Nuxt, `error(404)` in SvelteKit), not an empty template under a 200.
- Infinite scroll runs in the browser: the "load more" request goes straight to the API with the same query and `page + 1`, and `meta.total` from the server render seeds the stop condition.
- Treat a 304 as success in your fetch wrapper even though these routes never send one; see [caching and 304](../customize/conventions.md#browser-caching-and-304).
- The long form for all three frameworks is on [framework notes](./framework-notes.md).
