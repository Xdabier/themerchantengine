---
title: Add a string
description: "Where the storefront's own copy lives, the typed contract that makes every catalogue carry every key, the placeholders for the store name and country, how a template reads a string, and the tests that run each journey under every configured locale."
primaryQuery: add a translation string analog angular storefront i18n catalogue
updated: 2026-09-09
schema: HowTo
---

## When you need this

You need a new piece of chrome copy: a label, an error, a heading, a button. Chrome copy is the text the storefront ships in its own bundle, as opposed to product names and CMS bodies, which the API resolves per `Accept-Language` and sends as plain strings. Chrome copy lives in three TypeScript catalogues, one per language the build ships (`fr`, `en`, `ar`), typed against one interface so a key cannot exist in one and not the others. This page walks the `checkout.errors` group. You end with a key that compiles in every catalogue, reads correctly in a template, and is asserted under each locale the store serves.

## Files you touch

- `apps/storefront/src/i18n/types.ts`: `ChromeStrings`, the interface every catalogue must satisfy. Add the key here first.
- `apps/storefront/src/i18n/fr.ts`, `apps/storefront/src/i18n/en.ts`, `apps/storefront/src/i18n/ar.ts`: the catalogues. Each fails to compile until it carries the new key.
- `apps/storefront/src/i18n/index.ts`: `getChromeStrings(locale, identity)`, the resolver that fills placeholders and caches the result.
- `apps/storefront/src/i18n/identity.ts`: the `{store}` and `{country}` placeholders and `applyChromeIdentity`.
- `apps/storefront/src/app/locale.service.ts`: the `strings` signal every component reads.
- `apps/storefront/src/i18n/i18n.spec.ts`, `apps/storefront/src/i18n/brand-neutrality.spec.ts`, `apps/storefront/src/i18n/no-em-dash.spec.ts`: the guards.

## The pattern

### 1. Add the key to the contract

`apps/storefront/src/i18n/types.ts` groups keys by surface, nested objects, camelCase leaves, and a doc comment when the key's meaning is not obvious from its name:

```ts
export interface ChromeStrings {
  checkout: {
    errors: {
      addressRequired: string;
      invalidPhone: string;
      invalidCountry: string;
      requiredField: string;
      outOfStock: string;
      shippingUnavailable: string;
      paymentMethodUnavailable: string;
      guestCheckoutDisabled: string;
      generic: string;
    };
  };
}
```

The rule the file states in its own header: adding or removing a key is a compile-time edit across all languages. `fr.ts` is declared `const fr: ChromeStrings = { ... }`, so a missing leaf is a TypeScript error in that file, not a runtime blank.

### 2. Fill it in every catalogue

`apps/storefront/src/i18n/fr.ts`, the `checkout.errors` block (line 703):

```ts
const fr: ChromeStrings = {
  checkout: {
    errors: {
      addressRequired: 'Choisissez ou ajoutez une adresse de livraison.',
      invalidPhone: 'Saisissez un numéro de téléphone valide.',
      invalidPostalCode: 'Saisissez un code postal valide.',
    },
  },
};
```

The catalogue has more than one `errors` block with these names: `account.addresses.errors` (line 969 of `fr.ts`) repeats `requiredField`, `invalidPhone`, `invalidCountry`, `invalidPostalCode` and `generic` for the saved-address form. An edit anchored on `invalidPhone:` alone lands in whichever block comes first; anchor on the parent key, or find the line from `types.ts` and edit by path. `en.ts` carries `invalidPhone: 'Enter a valid phone number.'` and `ar.ts` carries the Arabic. Fill all three in the same commit; the Arabic catalogue is not allowed to hold a Latin fallback (see the guards below).

### 3. Use the placeholders, never the store's name

Copy that names the store or its market carries a placeholder. `apps/storefront/src/i18n/fr.ts`:

```ts
meta: {
  title: '{store}',
  description: 'Parcourez le catalogue, vérifiez le stock et commandez en ligne chez {store}.',
},
```

`applyChromeIdentity` in `apps/storefront/src/i18n/identity.ts` substitutes `{store}` with the configured store name and `{country}` with the country's name in the reader's language via `Intl.DisplayNames`. Counts and amounts use their own placeholders (`itemCountPlural: '{count} articles'`, `freeShippingRemaining: 'Ajoutez {amount} ...'`), which the consuming component replaces.

### 4. Read it in a component

`apps/storefront/src/app/locale.service.ts` exposes one signal:

```ts
readonly strings = computed(() => getChromeStrings(this._locale(), this.chromeIdentity()));
```

Components alias it and bind in the template. `apps/storefront/src/app/layout/footer.component.ts`:

```html
<h2 class="col-heading">{{ strings().footer.contactHeading }}</h2>
<p class="legal">{{ strings().footer.copyright }}</p>
```

`getChromeStrings` (`apps/storefront/src/i18n/index.ts`) returns the requested catalogue with the identity filled in, cached per locale and identity, and falls back to the default locale for an unknown code. It is pure, so calling it inside a `computed()` on every change-detection tick is safe.

### 5. Assert it under every locale

Journey specs hold a small per-locale map and read it with `copyFor`, which throws when the fixture serves a locale the map lacks. `apps/storefront-e2e/src/newsletter.journey.spec.ts`:

```ts
const INVALID_MSG = {
  en: 'Enter a valid email address.',
  fr: 'Saisissez une adresse e-mail valide.',
} as const;

describeEveryLocale('storefront NE9 newsletter', (locale) => {
  test(`an invalid email surfaces the localized validation message (${locale})`, async ({
    page,
  }) => {
    await page.goto(`/${locale}`);
    await page.getByTestId('newsletter-email').fill('not-an-email');
    await page.getByTestId('newsletter-submit').click();
    await expect(page.getByTestId('newsletter-invalid')).toContainText(
      copyFor(INVALID_MSG, locale),
    );
    await expect(page.getByTestId('newsletter-success')).toHaveCount(0);
  });
});
```

That test sits behind `STOREFRONT_E2E_BUILT === '1'` in the spec because a Reactive Form submit needs hydration, which the dev-server tier does not wait for. `describeEveryLocale` (`apps/storefront-e2e/src/support/locale-matrix.ts`) reads the locale set from the active scenario fixture, so the same spec runs `fr` and `en` under `maghreb-ltr` and `ar` and `en` under `gulf-rtl`. A spec that only knows two locales fails loudly under the third instead of asserting against `undefined`.

## Tests to run

```bash
npx nx test storefront
npx nx lint storefront
npx nx e2e storefront-e2e --grep=newsletter
STORE_CONFIG_FIXTURE=gulf-rtl npx nx e2e storefront-e2e --grep=newsletter
```

- `npx nx test storefront` runs the three guards. `i18n.spec.ts` walks every catalogue's key paths and compares them to `fr.ts`, checks that every `auth`, `checkout`, `orderConfirmation` and `account` leaf is non-empty, keeps Arabic script out of the Latin catalogues, and fails the Arabic catalogue on any four-letter Latin run outside a short allowlist. `brand-neutrality.spec.ts` reads the client-reference guard's token table, when the checkout has it, and fails on any leaf that matches, and separately asserts the identity leaves still carry their placeholder. `no-em-dash.spec.ts` reads the bytes of every catalogue and every component `template:` block.
- The lint run covers the template you edited.
- The two e2e lines run one journey under the default fixture and under the RTL one. On PowerShell set `$env:STORE_CONFIG_FIXTURE='gulf-rtl'` first.

## Gotchas

- The compile-time contract catches a missing key. The runtime guard in `i18n.spec.ts` catches the other direction: a key quietly dropped from one catalogue while the interface still lists it as optional somewhere. Keep leaves required in `ChromeStrings`.
- The em-dash is banned from catalogues and templates by bytes, so a label assembled in a binding is caught too. Use a comma or a period.
- The Arabic guard strips `{placeholder}` tokens before scanning, so `{count}` is fine; a copied English sentence is not. The allowlist is four literals (`English`, `Français`, two example emails). Do not widen it to make a test pass.
- A leaf that names the store or its market without a placeholder fails `brand-neutrality.spec.ts` and `npm run verify:no-client-refs`. The list of identity leaves is in the spec; add yours there when you add a leaf that takes `{store}` or `{country}`.
- `DEFAULT_LOCALE` in `types.ts` is `fr` and is a last resort for a caller with no config. Every real decision reads `localization.defaultLocale` from the store config; do not branch on the constant in a component.
- The locale catalogue is the three languages the build ships. Which of them a store serves is runtime config. A new language is a registry entry plus a catalogue file; the steps are in [Add a language](./add-a-language.md).
- `getChromeStrings` caches up to thirty-two resolved catalogues per process. That is one per locale in practice; a test that constructs many identities will see the cache clear, which is harmless.
