---
title: Run the engine
description: "Install the engine locally in two commands, learn what the demo fixture holds, where the API lives with its /api prefix, and make the first two requests: GET /health and GET /v1/store/config."
primaryQuery: run ecommerce api locally storefront base url health store config
updated: 2026-09-09
schema: HowTo
---

Before a storefront renders anything it needs an engine to talk to. This page gives you one on your laptop, tells you what the demo store in it looks like, and proves the connection with two requests you can paste. Every response on this track was captured from a local engine serving the `demo` fixture; the public URL shape the pages show, `https://api.shop.example/api/v1/...`, is what your production storefront will use.

## Install in two commands

Follow [Install locally](../getting-started/install-locally.md). It is one `git clone` and one wrapper (`./setup.sh --local` on Linux and macOS, `.\setup.ps1` on Windows), takes about seven minutes the first time, and leaves the API on `http://localhost:53000`, the admin on `http://localhost:53200` and the shipped storefront on `http://localhost:53300`. That page is the reference for the prompts, the containers and the teardown; nothing here repeats it.

If you develop inside the engine repository instead, `npx nx serve api` listens on the same port 53000.

## The demo fixture

The install seeds the `demo` store, whose definition is `test/fixtures/store-configs/demo.config.json`. Every value you will meet on this track comes from it:

- Identity: "Demo Store" in English, "Boutique Démo" in French, brand name `demo`, a French address in Lyon, `businessType` `OnlineStore`.
- Locales: `en` (default) and `fr`, both left-to-right, timezone `Europe/Paris`.
- Money: EUR, symbol `€` after the amount, `,` as the decimal separator, a space as the thousands separator, two decimals, prices shown tax included (`TTC`), 20% VAT.
- Checkout: a flat domestic shipping rate of 10,00 € for France, cash on delivery as the only payment method, guest checkout enabled.
- A catalogue with products, categories, copy in both locales and a few seeded customers.

Nothing in the fixture is a secret; it is the shape a real store fills in through the install stepper and the admin.

## The base URL and the /api prefix

The API mounts every route under a global prefix, `api`, then a version segment, `v1`:

- Local: `http://localhost:53000/api/v1/store/config`
- Production: `https://api.<your-domain>/api/v1/store/config`

The pages on this track write `https://api.shop.example/api/v1/...` for the production shape. Keep the prefix in one constant in your storefront, `https://api.shop.example/api`, and append `/v1/...` to it. Two things sit outside it:

- `GET /health` is served at the root, `http://localhost:53000/health`, not under `/api`. `GET /api/health` is a 404 (shown below).
- The Better Auth routes live under the prefix, `/api/v1/auth/*`, and are covered on [Auth and session](./02-auth-and-session.md).

## The request

Two requests prove the engine is up and configured. The first is the liveness probe. The second is the public store configuration, the first call every storefront makes.

```bash
curl -s -D - http://localhost:53000/health
curl -s -D - -H "Accept-Language: en" http://localhost:53000/api/v1/store/config
```

The same in framework-neutral JavaScript. It runs unchanged in Node 22 and in a browser; `credentials: 'include'` is what makes a browser send the cookies later pages set, and Node ignores it.

```js
const API = 'https://api.shop.example/api';

const health = await fetch('https://api.shop.example/health');
console.log((await health.json()).data.status); // "ok"

const response = await fetch(`${API}/v1/store/config`, {
  headers: { Accept: 'application/json', 'Accept-Language': 'en' },
  credentials: 'include',
});
const { data } = await response.json();
console.log(data.identity.storeName, data.money.currencyCode); // "Demo Store" "EUR"
```

Send `Accept-Language` on every call. It picks the locale every translatable field is resolved to; the rules are on the conventions page under [Translatable text and locale resolution](../customize/conventions.md#translatable-text-and-locale-resolution).

## The response

`GET /health`, headers and body as the engine sent them:

```http
HTTP/1.1 200 OK
Cache-Control: no-store
X-Request-Id: 6381a27d-22f2-41f2-be0b-33cca48b9225
Content-Type: application/json; charset=utf-8
Content-Length: 63
```

```json
{"data":{"status":"ok","timestamp":"2026-09-09T16:01:20.157Z"}}
```

`GET /v1/store/config` with `Accept-Language: en`. The headers matter: this is the one route a browser may cache, for sixty seconds, keyed on the locale headers.

```http
HTTP/1.1 200 OK
Cache-Control: public, max-age=60
Vary: X-Locale, Accept-Language, X-Resolve-Locale
X-Request-Id: 54c286f4-4a2e-40ff-8afb-4cb9e62454ad
Content-Type: application/json; charset=utf-8
Content-Length: 2260
```

```json
{
  "data": {
    "identity": {
      "storeName": "Demo Store",
      "brandName": "demo",
      "description": "A demonstration store for themerchantengine.",
      "legalName": "Demo Store SAS",
      "contact": {
        "email": "hello@demo.example",
        "phone": "+33100000000"
      },
      "address": {
        "street": "1 Rue de la Démo",
        "locality": "Lyon",
        "region": "Auvergne-Rhône-Alpes",
        "postalCode": "69001",
        "country": "FR"
      },
      "areaServed": [
        "FR"
      ],
      "businessType": "OnlineStore"
    },
    "brand": {
      "baseColors": {
        "primary": "#1F4E79",
        "secondary": "#F2B441",
        "accent": null
      },
      "fontKit": "latin-rounded",
      "logoAssetId": null,
      "faviconAssetId": null,
      "generatedPalette": {
        "tokens": {
          "--brand-bg": "#fcfcfd",
          "--brand-surface": "#f3f4f4",
          "--brand-surface-elevated": "#ffffff",
          "--brand-text": "#1a1c1e",
          "--brand-text-muted": "#656b72",
          "--brand-text-inverse": "#fcfcfd",
          "--brand-primary": "#1f4e79",
          "--brand-primary-hover": "#183c5d",
          "--brand-primary-active": "#102940",
          "--brand-on-primary": "#fcfcfd",
          "--brand-accent": "#f2b441",
          "--brand-on-accent": "#1a1c1e",
          "--brand-success": "#1e7f47",
          "--brand-warning": "#906722",
          "--brand-error": "#a42f27",
          "--brand-info": "#276aa4",
          "--brand-border": "#e4e6e7",
          "--brand-border-strong": "#858d93",
          "--brand-border-interactive": "#868d94",
          "--brand-focus-ring": "#1f4e79",
          "--brand-surface-strong": "#ecedee",
          "--brand-on-functional": "#fcfcfd"
        },
        "adjustments": [
          {
            "token": "--brand-accent",
            "reason": "accent-from-secondary",
            "from": "#F2B441",
            "to": "#f2b441"
          },
          {
            "token": "--brand-success",
            "reason": "contrast",
            "from": "#27a45b",
            "to": "#1e7f47",
            "against": "--brand-surface",
            "ratio": 4.56
          },
          {
            "token": "--brand-warning",
            "reason": "contrast",
            "from": "#a47627",
            "to": "#906722",
            "against": "--brand-surface",
            "ratio": 4.59
          },
          {
            "token": "--brand-border-strong",
            "reason": "contrast",
            "from": "#b3b8bc",
            "to": "#858d93",
            "against": "--brand-surface",
            "ratio": 3.06
          },
          {
            "token": "--brand-border-interactive",
            "reason": "contrast",
            "from": "#a3a9ae",
            "to": "#868d94",
            "against": "--brand-surface",
            "ratio": 3.05
          }
        ]
      }
    },
    "localization": {
      "supportedLocales": [
        "en",
        "fr"
      ],
      "defaultLocale": "en",
      "rtlLocales": [],
      "timezone": "Europe/Paris"
    },
    "money": {
      "currencyCode": "EUR",
      "symbol": "€",
      "symbolPosition": "after",
      "decimalSeparator": ",",
      "thousandsSeparator": " ",
      "displayPrecision": 2,
      "taxDisplay": "TTC",
      "vatRate": 0.2
    },
    "domains": {
      "storefront": "https://demo.example",
      "admin": "https://admin.demo.example",
      "api": "https://api.demo.example"
    }
  }
}
```

Every success on this API is `{ "data": ... }`, with a `meta` block when the route is a list. What each block of this payload means for your storefront, and how to turn it into CSS, a direction and a price, is the next page: [Config, locale and money](./01-config-locale-money.md).

## Error codes

Neither route takes parameters, so the only codes they can answer are the platform ones. The full catalogue is [Error codes](../reference/error-codes.md); the envelope rules are under [Response and error envelopes](../customize/conventions.md#response-and-error-envelopes).

- `NOT_FOUND`, 404: the path does not exist. The most common first-day mistake is putting `/health` under the prefix. The storefront shows nothing for this one; it is a build-time bug.
- `RATE_LIMITED`, 429: `GET /v1/store/config` allows 100 requests per minute per client. Cache it (next page) and this never fires from a storefront.

Proof, `GET /api/health`:

```http
HTTP/1.1 404 Not Found
Cache-Control: no-store
X-Request-Id: 583dd8b8-9310-4194-8f3c-32bf57485d3a
Content-Type: application/json; charset=utf-8
```

```json
{"error":{"code":"NOT_FOUND","message":"Cannot GET /api/health","details":{"message":"Cannot GET /api/health","error":"Not Found","statusCode":404}}}
```

`details` is present because the engine ran outside production; a production engine omits it.

## Every locale

`GET /health` has no locale. `GET /v1/store/config` does: the same request with `Accept-Language: fr` answers the same payload with every translatable field switched. Only the `identity` block differs, shown trimmed to it:

```json
{
  "identity": {
    "storeName": "Boutique Démo",
    "brandName": "demo",
    "description": "Une boutique de démonstration pour themerchantengine.",
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
}
```

`brand`, `localization`, `money` and `domains` are byte-identical under both locales: the money format is the store's, not the reader's.

## Framework notes

- Keep the base URL in an environment variable your framework reads at SSR (`API_URL` in Next.js server code, `runtimeConfig.apiUrl` in Nuxt, `$env/dynamic/private` in SvelteKit) and a second, public one for the browser (`NEXT_PUBLIC_API_URL`, `runtimeConfig.public.apiUrl`, `$env/dynamic/public`).
- The two may differ. The server reaches the API over the internal network (`http://api:3000/api` inside a compose stack, `http://localhost:53000/api` on a laptop); the browser reaches it over the public host (`https://api.shop.example/api`). The shipped storefront reads `STOREFRONT_API_URL` on the server and defaults to `http://localhost:53000/api`.
- Never hard-code the prefix per call. One constant, `/v1/...` appended, and a mistyped path is a 404 you see once.
- The long form for Next.js, Nuxt and SvelteKit is [Framework notes](./framework-notes.md).
