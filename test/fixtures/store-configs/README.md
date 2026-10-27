# Scenario store configs

Fictional store configurations that automated tests run the engine under (DR-31, plan E0.4). No real client name, domain, logo or catalogue appears here; `scripts/verify-no-client-refs.ts` scans this directory with no allowlist entry, which is the proof they are brandless.

## Fixtures

- `demo.config.json`: neutral baseline. `en` default + `fr`, both LTR, `EUR` with two decimals and the symbol after the number, tax shown `TTC`. Visual-regression baselines and single-fixture runs use it.
- `gulf-rtl.config.json`: shaped like a Gulf store. `ar` default + `en`, `ar` in the RTL set, the Arabic-capable font kit, a two-decimal currency with the symbol before the number, five percent VAT, no tax mention on prices, a Gulf address shape (building, street, area, emirate, no postcode).
- `maghreb-ltr.config.json`: shaped like a Maghreb store. `fr` default + `en`, both LTR, the Latin font kit, a three-decimal currency with the symbol after the number and a narrow no-break space as thousands separator, nineteen percent VAT, prices shown `HT`, a French-style postal address.
- `trilingual.config.json`: three locales. `ar` default + `fr` + `en`, `ar` in the RTL set, the Arabic-capable font kit, `GBP` with two decimals, tax shown `TTC`. It matches the neutral locale set DR-33 boots with.

The currencies and countries are real ISO codes that belong to neither client, chosen for their decimal exponent and script; the VAT rates and display rules are fixture parameters, not claims about those countries.

## Shape

Every file has the groups the E1.1 config spine adds to `StoreSetting`, plus a `fixture` block. E1.1 implements the settings keys against this shape; the Zod schema in `libs/shared/common/src/store-config-fixtures/` is the single definition and every fixture must parse under it.

- `fixture`: `id` (the file name) and `description`.
- `identity`: `storeName` (Translatable, one key per supported locale plus `default`), `brandName` (rendered verbatim), `description` (Translatable), `legalName` (Translatable), `contact` (`email`, `phone` in E.164), `address` (`street` Translatable, `locality`, `region`, `postalCode` nullable, `country` ISO 3166-1 alpha-2), `areaServed` (country codes), `businessType`.
- `brand`: `baseColors` (`primary`, optional `secondary` and `accent`, hex), `fontKit` (`latin-rounded` or `arabic-latin`), `logoAssetId` and `faviconAssetId` (null in fixtures; the stepper uploads real files).
- `localization`: `supportedLocales`, `defaultLocale`, `rtlLocales`, `timezone` (IANA).
- `money`: `currencyCode` (ISO 4217), `symbol`, `symbolPosition` (`before` or `after`), `decimalSeparator`, `thousandsSeparator`, `displayPrecision`, `taxDisplay` (`HT`, `TTC` or `none`), `vatRate` (fraction).
- `domains`: `storefront`, `admin`, `api` (origins, `https://` with no path). Fixtures use `.example` hosts.

Outside the fixture shape on purpose: `brand.generatedPalette` is derived by the E2.1 generator from `baseColors` when the config is written. `business.geoLat`, `geoLng` and `priceRange` have no fixture source and are seeded empty. The schema is strict: an unknown key in any group fails the parse, so a typo cannot hide. Translatable objects are the one open shape (any locale key is accepted there), and a missing required locale is caught by the locale refinement.

## Loading

```ts
import { loadStoreConfigFixture, activeStoreConfigFixture } from '@common/store-config-fixtures';

const gulf = loadStoreConfigFixture('gulf-rtl');
const active = activeStoreConfigFixture(); // STORE_CONFIG_FIXTURE, default demo
```

The three e2e harnesses read `STORE_CONFIG_FIXTURE` in their global setup, seed the `StoreSetting` keys that exist today from the active fixture, and expose `activeStoreConfigFixture()` so locale-matrix and money assertions derive from it. Keys the fixture carries that have no `StoreSetting` home yet wait for E1.1.
