---
title: Add a language
description: "The one registry entry that teaches the engine a new language, the storefront string file, the API copy tables and the font check that go with it, how search follows by regeneration, and how a store switches the language on at runtime."
primaryQuery: add a language locale to the store registry german spanish storefront translation
updated: 2026-11-24
schema: HowTo
---

## When you need this

A store needs to serve a language the engine does not list yet, for example German beside French, English and Arabic. The engine knows its languages from one registry, so adding one is a registry entry plus its copy. There is no database migration and no change to the config schema: the schema, the DTO checks, the admin tabs, the hreflang tags, the invoice typesetting and the search vector all read the registry. Only the text itself (mail copy, invoice labels, storefront strings) needs your translation. You end with a language the setup installer offers and a store can enable at runtime.

## Files you touch

- `libs/shared/common/src/locale/locale-registry.ts`: `LOCALE_REGISTRY`, the one entry per language.
- `libs/shared/common/src/locale/locale-registry.spec.ts`: the parity canary that fails when an entry lacks a field.
- `apps/storefront/src/i18n/fr.ts`: the model for the new string file, which sits beside it and is named after the new code.
- `apps/storefront/src/i18n/index.ts`: the `buildCatalogues` call that lists the catalogues.
- `apps/storefront/src/i18n/types.ts`: `ChromeStrings`, the contract the string file follows.
- `apps/storefront/src/i18n/catalogue.ts`: `buildCatalogues` and `mergeWithFallback`, which fill missing keys from the default language.
- `apps/api/src/modules/orders/invoice-pdf.service.ts`: the invoice labels and month names (`LABELS`, `MONTHS`).
- `prisma/notification-template-defaults.ts`: the mail copy, one entry per language. The `Translatable` type is closed to `fr`, `en` and `ar`, and the `TTC` and `HT` tax mentions are keyed by language too.
- The other API copy tables (mail chrome, dates, digests, campaigns, promotions, notifications, geo FAQ): listed in step 4.
- `prisma/fts-setup-sql.ts`: builds the search SQL from the registry; you run it, you do not edit it.
- `tools/setup/src/steps/localization.ts`: the installer step that lists the registry.
- `tools/guards/src/locale-literals.spec.ts`: the guard that fails on a hardcoded locale pair.

## The pattern

### 1. Add the registry entry

`LOCALE_REGISTRY` holds one `LocaleDefinition` per language. Every field is required:

```ts
de: {
  code: 'de',
  label: 'German',
  nativeName: 'Deutsch',
  direction: 'ltr',
  script: 'latin',
  intlTag: 'de-DE',
  ogRegion: 'DE',
  textSearchConfig: 'german',
  typography: { spaceBeforeHighPunctuation: false },
},
```

`textSearchConfig` must be a Postgres text search configuration that exists in your database (`german` ships with Postgres). `direction` is `'rtl'` for right to left languages. `script` is `'latin'` or `'arabic'`.

### 2. Check the font kit

A store picks a font kit, and a kit only covers the scripts in `FONT_KIT_SCRIPTS`. `latin-rounded` covers Latin; `arabic-latin` covers Latin and Arabic. A new Latin language needs nothing. A language in a new script (Cyrillic, Hebrew) needs a kit that ships a face for that script first: add the script to `SCRIPTS`, the face to a kit, and the kit to `FONT_KIT_SCRIPTS`. The installer, the storefront brand tokens and the invoice renderer all ask `fontKitCoversLocale`, so the check can say whether a kit can draw a language before it renders.

### 3. Add the storefront string file

Create a file named after the new code beside `fr.ts` (`de.ts` for German) that exports the same shape, and add it to the call in `index.ts`:

```ts
const STRINGS = buildCatalogues<ChromeStrings>({ fr, en, ar, de }, DEFAULT_LOCALE);
```

`buildCatalogues` fills every missing or empty key from the default language, so you can ship the file half translated. A visitor sees the default language's text for the keys you have not done yet. Translate the rest before you call the language finished.

### 4. Add the API copy

Per-language text lives in several API tables. The compiler enforces only some of them, so use this list as the checklist.

Typed in the code, so a missing entry shows up in the editor and the build:

- `apps/api/src/modules/orders/invoice-pdf.service.ts`: `LABELS` and `MONTHS`. Fill them in the same commit as the registry entry.
- `prisma/notification-template-defaults.ts`: the closed `Translatable` type (`fr`, `en`, `ar`). Widen it, then add the new code to each mail entry. The `TTC` and `HT` tax mentions take it too.

Open records. The compiler cannot see them, and at runtime a missing entry falls back to the store default language:

- `apps/api/src/modules/mail/templates/layout.ts`: `FOOTER_NOTE`, `UNSUBSCRIBE_LABEL`, `TAX_INCLUDED`, `TAX_EXCLUDED`.
- `apps/api/src/modules/mail/templates/*.ts`: the `COPY` table in each template file, used when no database template row exists.
- `apps/api/src/modules/mail/dispatch/resolvers.ts`: the refund and exchange lines.
- `apps/api/src/modules/mail/mail-date.util.ts`: `AT`.
- `apps/api/src/modules/mail/scheduled/staff-digest.processor.ts`: `PERIOD_LABEL`.
- `apps/api/src/modules/campaigns/winback-defaults.ts`: `WINBACK_DEFAULT_SUBJECT` and the body.
- `apps/api/src/modules/campaigns/campaign.service.ts`: `FREE_SHIPPING_LABEL`.
- `apps/api/src/modules/promotions/promotions.service.ts`: the free shipping progress messages.
- `apps/api/src/modules/notifications/notifications.constants.ts`: `NOTIFICATION_TEMPLATES`.
- `apps/api/src/modules/geo/geo.constants.ts`: `GEO_FAQ_TEMPLATES`.
- `apps/api/src/modules/geo/geo.service.ts`: `LLMS_NEUTRAL_DESCRIPTION`.
- `apps/api/src/modules/seo/processors/google-merchant-feed.processor.ts`: `CHANNEL_DESCRIPTION`.

Search the API for a neighbouring language code (for example `ar:`) to catch any table this list misses. Write every entry before you call the language finished.

### 5. Regenerate the search SQL

```bash
npm run db:fts:generate
npm run db:push
```

`db:fts:generate` rewrites `prisma/search_fts_setup.sql` with a weighted segment and trigram indexes for the new language. `db:push` applies it. A drift spec fails when the committed SQL no longer matches the registry.

### 6. Turn it on for a store

A language in the registry is available, not active. A store enables it through its runtime config: one `PATCH /v1/admin/settings/locales` call sets `supportedLocales`, the default and `rtlLocales`. Or answer the installer's Locales step, which lists the registry. After that the admin shows a tab for the language on each Translatable field, and the storefront serves `/<code>/...` with its hreflang tags.

## Tests to run

```bash
npx nx test api
npx nx test storefront
npm run test:setup
npm run docs:generate
npx nx run guards:test
npm run test:e2e
```

`locale-registry.spec.ts` fails with the name of the field when an entry misses one. `catalogue.spec.ts` pins the fallback. The guard in `locale-literals.spec.ts` fails if you wrote a locale pair in code instead of reading the registry. Specs that need a language the registry does not have register a scratch one with `registerScratchLocale(code, direction)` from `@common/locale`, which is how the engine proves a fourth language without shipping one.

## Gotchas

- The registry is code, so a new language ships with a deploy. Turning it on for a store is a config change.
- Keep the code out of any hand-written list of languages. The registry replaced that list, and the locale guard fails when code names a locale pair. The copy tables in step 4 hold text, so each one needs an entry.
- A right to left language also needs the code in the store's `rtlLocales`, or the page renders left to right.
- Product names, CMS bodies and other Translatable fields are data. Adding the language does not translate them; editors fill the new tab.
- Run the search regeneration before you test search. Without it the new language has no weighted segment and its words do not match.
