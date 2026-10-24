---
title: Config, locale and money
description: "GET /v1/store/config, field by field: identity, brand tokens as CSS custom properties, locales and direction, the money format with a three-decimal currency, tax display, domains, the sixty-second public cache, and what GET /v1/storefront/config adds."
primaryQuery: storefront config api brand tokens locales rtl money format cache
updated: 2026-09-09
schema: TechArticle
---

`GET /v1/store/config` is the first request a storefront makes and the only one it needs before it can paint a page: the store's name, its palette and fonts, which locales it speaks and which way they read, how a price is written, and which domains are canonical. Rendering from this payload rather than from constants in your code is obligation one of [the contract](./index.md#the-ten-obligations): one build of your storefront serves any store the engine is configured as. This page walks the payload block by block, shows a price formatted from it in ten lines, and covers the cache and the older `GET /v1/storefront/config` the shipped app also reads.

## The request

`GET /v1/store/config`. Public, no cookie, no parameters. Two headers matter:

- `Accept-Language`: the locale every translatable field (`storeName`, `description`, `legalName`, `address.street`) is resolved to. From a browser page send `X-Locale` as well; the API reads it first, because some browsers refuse to let a page set `Accept-Language`. The three-rung resolution (requested locale, store default, `default`) is on the conventions page under [Translatable text and locale resolution](../customize/conventions.md#translatable-text-and-locale-resolution).
- `X-Resolve-Locale: false` returns the translatable fields as whole objects (`{ "en": ..., "fr": ..., "default": ... }`). A storefront never needs this; an admin edit form does.

```bash
curl -s -D - -H "Accept-Language: en" https://api.shop.example/api/v1/store/config
```

```js
const API = 'https://api.shop.example/api';

async function loadStoreConfig(locale) {
  const response = await fetch(`${API}/v1/store/config`, {
    headers: { Accept: 'application/json', 'Accept-Language': locale, 'X-Locale': locale },
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`store config: ${response.status}`);
  return (await response.json()).data;
}

const config = await loadStoreConfig('en');
```

The route's reference entry is [Store (storefront API)](../reference/storefront-api/store.md); the schema, field by field, is [Store config](../reference/store-config.md). One thing to know when reading that schema: it documents the stored shape, where `identity.storeName` is an object with a `default` key. On the wire, under a locale header, each of those fields is a plain string, as every paste below shows. The object shape only appears with `X-Resolve-Locale: false`.

## The response

The full payload is pasted on [Run the engine](./00-run-the-engine.md#the-response); this page takes it block by block. The headers first, because they carry the cache contract:

```http
HTTP/1.1 200 OK
Cache-Control: public, max-age=60
Vary: X-Locale, Accept-Language, X-Resolve-Locale
X-Request-Id: 54c286f4-4a2e-40ff-8afb-4cb9e62454ad
Content-Type: application/json; charset=utf-8
Content-Length: 2260
```

### identity

```json
{
  "storeName": "Demo Store",
  "brandName": "demo",
  "description": "A demonstration store for themerchantengine.",
  "legalName": "Demo Store SAS",
  "contact": { "email": "hello@demo.example", "phone": "+33100000000" },
  "address": {
    "street": "1 Rue de la Démo",
    "locality": "Lyon",
    "region": "Auvergne-Rhône-Alpes",
    "postalCode": "69001",
    "country": "FR"
  },
  "areaServed": ["FR"],
  "businessType": "OnlineStore"
}
```

A storefront renders `storeName` in the header, the `<title>` suffix and the Organization JSON-LD; `description` as the default meta description; `legalName`, `address` and `contact` in the footer and the legal pages; `areaServed` and `businessType` in the JSON-LD. `brandName` is a short machine-safe name (a manifest `short_name`, an email sender name). A fresh store has empty strings here, never missing keys, so render conditionally and never crash on `""`.

### brand

```json
{
  "baseColors": { "primary": "#1F4E79", "secondary": "#F2B441", "accent": null },
  "fontKit": "latin-rounded",
  "logoAssetId": null,
  "faviconAssetId": null,
  "generatedPalette": {
    "tokens": {
      "--brand-bg": "#fcfcfd",
      "--brand-surface": "#f3f4f4",
      "--brand-primary": "#1f4e79",
      "--brand-on-primary": "#fcfcfd",
      "--brand-accent": "#f2b441",
      "--brand-error": "#a42f27"
    },
    "adjustments": [
      { "token": "--brand-accent", "reason": "accent-from-secondary", "from": "#F2B441", "to": "#f2b441" },
      { "token": "--brand-success", "reason": "contrast", "from": "#27a45b", "to": "#1e7f47", "against": "--brand-surface", "ratio": 4.56 }
    ]
  }
}
```

Trimmed: the real `tokens` map holds twenty-two entries and `adjustments` five; see the full paste on the previous page.

Render `generatedPalette.tokens`, not `baseColors`. The operator picks up to three colours; the engine expands them into a complete, contrast-checked token set, and `adjustments` records every token it had to move and why (`contrast` against a surface, `accent-from-secondary` when no accent was given). The token names are already CSS custom property names, so the whole block is one `:root` rule:

```js
function brandCss(brand) {
  const tokens = brand.generatedPalette?.tokens ?? {};
  const lines = Object.entries(tokens).map(([name, value]) => `  ${name}: ${value};`);
  return `:root {\n${lines.join('\n')}\n}`;
}
// <style id="brand-tokens">:root { --brand-bg: #fcfcfd; --brand-surface: #f3f4f4; ... }</style>
```

Put that `<style>` in the head of the server-rendered HTML, before the first paint, so a visitor never sees a fallback palette flash to the real one. Keep a neutral copy of the same token names in your own stylesheet so the page still renders when the config read failed. The shipped storefront does exactly this in `apps/storefront/src/app/services/brand-tokens.service.ts`: it writes the block on the server pass only, once, and rewrites `<meta name="theme-color">` to `--brand-primary`; `apps/storefront/src/server/routes/site.webmanifest.ts` takes `background_color` and `theme_color` from the same two tokens.

`fontKit` is one of two allowlisted kits, and it selects families your build already ships:

- `latin-rounded`: display `Baloo 2`, body `Inter`.
- `arabic-latin`: display `Cairo`, body `Tajawal` with `Inter` as the fallback for the punctuation a grouped price uses.

A store that enables `ar` must pick `arabic-latin`. The shipped service emits `--brand-kit-display` and `--brand-kit-body` next to the palette, plus a type scale per kit, because the Arabic faces read smaller at the same pixel size.

`logoAssetId` and `faviconAssetId` are asset ids, `null` until the operator uploads one; the resolved logo URL is on `GET /v1/storefront/config` (below).

### localization

```json
{
  "supportedLocales": ["en", "fr"],
  "defaultLocale": "en",
  "rtlLocales": [],
  "timezone": "Europe/Paris"
}
```

- `supportedLocales` is the route set: the shipped storefront serves `/{locale}/...` for each and redirects `/` to `defaultLocale`. A locale outside the list is a 404, not a fallback.
- `rtlLocales` decides `dir`. Set `lang` and `dir` on `<html>` per page: `dir="rtl"` when the page locale is in `rtlLocales`, `ltr` otherwise. `apps/storefront/src/app/locale.service.ts` computes `direction` from exactly this list and writes both attributes. The `demo` fixture has no RTL locale; a Gulf store with `"rtlLocales": ["ar"]` renders its Arabic pages mirrored and its French pages not.
- `timezone` formats dates (order placed at, delivery windows) so a customer and the operator read the same clock.

### money

```json
{
  "currencyCode": "EUR",
  "symbol": "€",
  "symbolPosition": "after",
  "decimalSeparator": ",",
  "thousandsSeparator": " ",
  "displayPrecision": 2,
  "taxDisplay": "TTC",
  "vatRate": 0.2
}
```

Prices leave the API as plain numbers (`350`, `12.5`); this block says how to write them. The format is the store's, not the reader's: a French and an English page of the same store both show `1 990,50 €`. Do not let `Intl` pick separators from the page locale, or the same store renders `1,990.50` on one page and `1 990,50` on the next, and an Arabic locale switches to Arabic-Indic digits.

`displayPrecision` is `0` to `3`. A three-decimal currency (KWD, BHD, OMR) carries `"displayPrecision": 3`, and `12.5` must render as `12.500`, never `12.50`. Everything that pins two fraction digits is wrong for such a store.

`taxDisplay` labels the price: `TTC` means the amounts shown include tax, `HT` means they exclude it, `none` means show no label. `vatRate` (`0.2` here) is for the label text ("incl. 20% VAT") and the tax line at checkout; the amounts themselves come from the checkout routes.

### domains

```json
{
  "storefront": "https://demo.example",
  "admin": "https://admin.demo.example",
  "api": "https://api.demo.example"
}
```

`storefront` is the canonical origin: build `<link rel="canonical">`, `hreflang` alternates and the `url` in JSON-LD from it, never from the request host, so a preview host or a proxy does not leak into search results. `api` is the origin the engine itself puts in emails and feeds. A fresh store has empty strings; fall back to the request origin only then.

## Format a price

Ten lines, framework-neutral, from the `money` block. `Intl.NumberFormat` under a fixed `en-US` does the rounding at the configured precision (it rounds the decimal value, where `toFixed` rounds the binary double), and the store's separators are applied afterwards:

```js
function formatPrice(amount, money) {
  const digits = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: money.displayPrecision,
    maximumFractionDigits: money.displayPrecision,
    useGrouping: false,
  }).format(amount);
  const [whole, fraction] = digits.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, money.thousandsSeparator);
  const number = fraction ? `${grouped}${money.decimalSeparator}${fraction}` : grouped;
  return money.symbolPosition === 'before' ? `${money.symbol} ${number}` : `${number} ${money.symbol}`;
}
```

Checked against a real price. `GET /v1/products/fx-bottle-hydra-bottle-500` under both locales answers the same product and the same variant; only the translated fields differ. Trimmed to the fields a price needs (the description, `assets`, `tags` and `primaryAsset` blocks are omitted here; [Catalog and search](./03-catalog-and-search.md) covers them):

```json
{
  "data": {
    "id": "cmtub361w001nwcqsf7pr7kb9",
    "name": "Hydra Bottle 500",
    "slug": "fx-bottle-hydra-bottle-500",
    "variants": [
      {
        "id": "cmtub3626001owcqsruhqmn70",
        "productId": "cmtub361w001nwcqsf7pr7kb9",
        "sku": "FX-HM-HB500",
        "price": 89,
        "compareAtPrice": 109,
        "isDefault": true,
        "availability": "IN_STOCK"
      }
    ]
  }
}
```

Under `fr` the `name` is `"Gourde Hydra Bottle 500"` and the variant is the same. `compareAtPrice` is the struck-through "was" price; render it with the same function. One thing the run showed: the paste above is the first, uncached read, where `compareAtPrice` is the number `109`; every read after it, served from the engine's product cache, answered the string `"109"` under both locales. Coerce money fields with `Number()` before formatting so a cached read renders the same as a fresh one.

```js
formatPrice(89, config.money);     // "89,00 €"    under en and under fr alike
formatPrice(109, config.money);    // "109,00 €"   the compareAtPrice
formatPrice(1990.5, config.money); // "1 990,50 €"
// A three-decimal store: { symbol: "KD", symbolPosition: "before", decimalSeparator: ".", thousandsSeparator: ",", displayPrecision: 3 }
formatPrice(1234.5, kuwaitiMoney); // "KD 1,234.500"
```

Use a no-break space between the number and the symbol in real markup so a line never breaks between them. The shipped formatter, `apps/storefront/src/lib/money.ts`, is this function plus one rule: an order line that carries its own historical currency (placed before the store changed currency) renders at that currency's ISO precision with its ISO code instead of the store symbol.

## The sixty-second cache

`GET /v1/store/config` is the one storefront route that answers `Cache-Control: public, max-age=60`; every other route answers `Cache-Control: no-store`, and the API emits no `ETag`, so a `304` never arrives (rules under [Browser caching and 304](../customize/conventions.md#browser-caching-and-304)). `Vary: X-Locale, Accept-Language, X-Resolve-Locale` means a shared cache keeps one copy per locale.

A storefront may hold the payload for the same sixty seconds, per locale, on the server and in the browser. It must re-read it after a revalidation call, because an operator who saves a settings screen expects the new name or palette on the next page, not a minute later; the engine tells your storefront when that happens on [Revalidation](./10-revalidation.md). The shipped storefront's server cache is `apps/storefront/src/server/store-config.ts`: one in-flight request per process, sixty seconds on success, five seconds after a failure, a committed neutral config when the API is unreachable (so an outage degrades to a default-shaped store instead of a 500 on every page), and `resetStoreConfigCache()` for the revalidate hook.

## GET /v1/storefront/config

The shipped app reads a second, narrower payload as well, `GET /v1/storefront/config` (reference: [Storefront (storefront API)](../reference/storefront-api/storefront.md)). Same request shape, no cookie, `Accept-Language` honoured. It answers `Cache-Control: no-store`, so cache it yourself if you call it per page.

```http
HTTP/1.1 200 OK
Cache-Control: no-store
X-Request-Id: 617324f5-d695-425b-ae82-d21b18635ab2
Content-Type: application/json; charset=utf-8
Content-Length: 393
```

```json
{
  "data": {
    "identity": {
      "storeName": "Demo Store",
      "contactEmail": "hello@demo.example",
      "phone": "+33100000000",
      "socialLinks": {},
      "logoUrl": null
    },
    "currency": {
      "code": "EUR",
      "symbol": "€",
      "decimalPlaces": 2
    },
    "locales": {
      "supportedLocales": [
        "en",
        "fr"
      ],
      "defaultLocale": "en"
    },
    "inventory": {
      "lowStockThreshold": 5
    },
    "pixels": {
      "googleAnalyticsId": null,
      "metaPixelId": null,
      "tiktokPixelId": null,
      "snapPixelId": null
    }
  }
}
```

What it adds over `store/config`: `socialLinks` (only the platforms the operator filled in), `logoUrl` (the resolved URL of `logoAssetId`), `inventory.lowStockThreshold` (the count under which a product page shows "only N left"), and `pixels` (the vendor tag ids to load). What it lacks: the palette, the font kit, `rtlLocales`, the money separators and precision beyond `decimalPlaces`, the tax display, the address and the domains. The service behind it, `apps/api/src/modules/storefront-config/storefront-config.service.ts`, is an explicit allowlist, so a setting the operator gains later never appears here by accident.

When to call which: `store/config` at boot, for everything above; `storefront/config` alongside it when you render the logo, the social links, the low-stock badge or the pixels. The shipped storefront wraps them in `libs/storefront-services/src/lib/storefront-config/store-runtime-config.service.ts` and `libs/storefront-services/src/lib/storefront-config/store-config.service.ts`, reads both once at SSR boot and carries them to the browser in transfer state; neither is a per-page call.

## Error codes

The route takes no parameters and no cookie, so it answers only the platform codes. Catalogue: [Error codes](../reference/error-codes.md).

- `RATE_LIMITED`, 429: 100 requests per minute per client. With the cache above a storefront makes one call a minute per locale, so this never fires; if it does, keep serving the last copy.
- `NOT_FOUND`, 404: the path is wrong. Unknown query parameters are ignored, not refused: `?foo=1` answered 200.

Proof, a mistyped path:

```bash
curl -s -D - -H "Accept-Language: en" https://api.shop.example/api/v1/store/configs
```

```http
HTTP/1.1 404 Not Found
Cache-Control: no-store
X-Request-Id: 300c341b-2b8e-46e5-bde6-9ce34f67db65
Content-Type: application/json; charset=utf-8
```

```json
{"error":{"code":"NOT_FOUND","message":"Cannot GET /api/v1/store/configs","details":{"message":"Cannot GET /api/v1/store/configs","error":"Not Found","statusCode":404}}}
```

## Every locale

The same request under `Accept-Language: en` and `Accept-Language: fr`. Only the four translatable strings in `identity` change; `brand`, `localization`, `money` and `domains` are byte-identical, and so is the product price above.

`en`:

```json
{ "storeName": "Demo Store", "description": "A demonstration store for themerchantengine.", "legalName": "Demo Store SAS", "address": { "street": "1 Rue de la Démo" } }
```

`fr`:

```json
{ "storeName": "Boutique Démo", "description": "Une boutique de démonstration pour themerchantengine.", "legalName": "Demo Store SAS", "address": { "street": "1 Rue de la Démo" } }
```

`legalName` and `street` are the same in both because the fixture gives them one value per locale; a field the operator translated switches, one they did not stays. No header at all resolves to the `default` key, which here equals `en`. With `X-Locale: fr` instead of `Accept-Language: fr` the answer is the same French payload.

Direction does not change on this store. On a store with `"rtlLocales": ["ar"]`, the payload is still the same under every locale; what changes is what your storefront does with it: `dir="rtl"` on the Arabic pages, `ltr` on the rest.

## Framework notes

- Fetch the config once per request on the server and cache it per process for sixty seconds, keyed on the locale: a `cache: 'force-cache'` fetch with `next: { revalidate: 60 }` in Next.js, `useAsyncData` with a server-side cache in Nuxt, a module-level cache in a SvelteKit `hooks.server.ts`. Pass the result to the page rather than re-fetching in components.
- Emit the `:root` token block and `lang`/`dir` in the root layout, from the server, before any client script runs.
- Expose the revalidation route on [Revalidation](./10-revalidation.md) and clear that cache from it.
- The long form for Next.js, Nuxt and SvelteKit is [Framework notes](./framework-notes.md).
