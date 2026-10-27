---
title: Change the theme
description: "Where the storefront palette, font kit and logo come from at request time, what the admin owns, what a developer may still change in component styles, and how to test a change under the three scenario fixtures."
primaryQuery: change storefront theme css custom properties analog angular
updated: 2026-09-09
schema: HowTo
---

## When you need this

You want the storefront to look different. The first question is whether the change is a value or a rule. Every colour, both font families, the type scale, the logo and the favicon are values in the store config, which the admin edits and the API serves on `GET /v1/store/config`. The storefront turns that payload into CSS custom properties on every request, so a colour change needs no code and no deploy. A developer changes rules: how a component consumes those tokens, its layout, its spacing, and the derived colours built from the generated ones. This page shows where each half lives, using the header lockup and the trust strip as the worked examples.

## Files you touch

- `apps/storefront/src/app/services/brand-tokens.service.ts`: turns the config's generated palette and font kit into the `:root { --brand-* }` block and injects it into the document head on the server pass. Read it; you rarely edit it.
- `apps/storefront/src/app/services/store-config.service.ts`: loads `/v1/store/config` once per render and carries it to the browser through `TransferState`. The `brand`, `localization`, `money` and `identity` signals every surface reads.
- `libs/shared/common/src/brand/palette.ts`: `generatePalette`, the pure function that expands one to three base colours into the full token set and proves every text-on-ground pair against WCAG AA. `BRAND_TOKEN_KEYS` is the list of token names.
- `apps/storefront/src/styles/brand.css`: the neutral fallback palette, the derived colours and the structural tokens. The one file allowed to hold a hex value, and only in its first section.
- `apps/storefront/src/styles/brand-tokens.spec.ts`: the guard. It pins `brand.css` to the generator's output for the neutral config and sweeps every storefront source file for a raw hex, a raw `rgba(...)` or a token nothing declares.
- `apps/storefront/src/app/locale.service.ts`: sets `<html lang>` and `<html dir>` from `localization.rtlLocales`. Direction is not a token.
- `apps/storefront/src/app/layout/header.component.ts`: reads the configured logo through `storeConfig.logoUrl()`.
- Any component whose `styles` you change, for example `apps/storefront/src/app/sections/home/trust-strip.component.ts`.

## The pattern

### 1. Know where the values come from

`apps/storefront/src/app/services/brand-tokens.service.ts` builds the block from `brand.generatedPalette.tokens` and the selected font kit, then appends one `<style id="brand-tokens">` on the server pass only:

```ts
cssText(): string | null {
  const brand = this.storeConfig.brand();
  const palette = brand.generatedPalette;
  if (!palette) return null;
  const kit = FONT_KITS[brand.fontKit] ?? FONT_KITS['latin-rounded'];
  const declarations = [
    ...Object.entries(palette.tokens).map(([token, value]) => `  ${token}: ${value};`),
    `  --brand-kit-display: ${kit.display};`,
    `  --brand-kit-body: ${kit.body};`,
    `  --brand-text-display: ${kit.scale.display};`,
    // ... the rest of the type scale
  ].join('\n');
  return `:root {\n${declarations}\n}`;
}

apply(): void {
  if (!isPlatformServer(this.platformId)) return;
  const css = this.cssText();
  if (!css) return;
  if (this.document.getElementById(BRAND_TOKENS_STYLE_ID)) return;
  const style = this.document.createElement('style');
  style.id = BRAND_TOKENS_STYLE_ID;
  style.textContent = css;
  this.document.head.appendChild(style);
  this.applyThemeColor();
}
```

`apps/storefront/src/app/app.config.ts` runs it after the config has loaded, inside `provideAppInitializer`, so the block is in the SSR HTML before first paint:

```ts
provideAppInitializer(() => {
  const storeConfig = inject(StoreConfigService);
  const brandTokens = inject(BrandTokensService);
  return storeConfig.load().then(() => brandTokens.apply());
}),
```

The injected block overrides the fallback in `apps/storefront/src/styles/brand.css` by cascade order. When the config read fails, the page renders on the neutral palette instead of failing.

### 2. Decide who owns the change

The admin owns everything in the store config: `brand.baseColors` (`primary`, optional `secondary` and `accent`), `brand.fontKit` (`latin-rounded` or `arabic-latin`), the logo and favicon assets, the locale set and `rtlLocales`, and the money format. Those are edited on the admin brand and settings screens; see [Store settings](../../../operate/store-settings.md). The generator in `libs/shared/common/src/brand/palette.ts` derives the other nineteen tokens and rejects a palette it cannot make pass AA, naming the failing pair. Do not hand-tune a generated colour in CSS.

A developer owns the consumers. `apps/storefront/src/app/sections/home/trust-strip.component.ts` is the shape to copy: every colour is a `var(--brand-*)`, every size a token, every property logical:

```ts
.strip {
  border-block-start: 3px solid var(--brand-primary);
  padding-block: 1.5rem;
  padding-inline: 0;
}
.subtitle {
  margin: 0;
  font-size: var(--brand-text-micro);
  color: var(--brand-text-muted);
}
```

### 3. Add a derived colour, never a literal

When a role has no token, add it to the second section of `apps/storefront/src/styles/brand.css` as a `color-mix` of a generated token:

```css
--brand-error-hover: color-mix(in oklab, var(--brand-error) 85%, black);
--brand-scrim-modal: color-mix(in srgb, var(--brand-text) 50%, transparent);
--brand-hover-overlay: color-mix(in srgb, var(--brand-text) 12%, transparent);
```

A hex or `rgba(...)` at a call site fails `apps/storefront/src/styles/brand-tokens.spec.ts`, which walks `apps/storefront/src` and excludes `brand.css` itself and every `*.spec.ts` file (`sourceFiles()` at lines 57-63). A colour literal inside a spec is not caught, so do not treat a green spec as proof that a test fixture is token-clean.

### 4. Fonts and direction

Both kits ship in every build: the twelve `@font-face` rules in `apps/storefront/src/styles/global.css` declare Baloo 2, Inter, JetBrains Mono, Cairo and Tajawal, and the config picks the kit. Components use `var(--brand-font-display)` and `var(--brand-font-body)`. `apps/storefront/src/app/locale.service.ts` derives direction from the config and writes it to the document:

```ts
readonly direction = computed<'ltr' | 'rtl'>(() =>
  this.storeConfig.localization().rtlLocales.includes(this._locale()) ? 'rtl' : 'ltr',
);
```

Because direction is runtime, use logical properties only (`margin-inline-start`, `padding-block`, `inset-inline-end`). A `margin-left` looks fine under an LTR fixture and mirrors wrong under the RTL one.

### 5. Logo

`apps/storefront/src/app/layout/header.component.ts` reads one mark for every locale and falls back to the bundled default:

```ts
protected readonly lockupSrc = computed(() => this.storeConfig.logoUrl() ?? DEFAULT_LOGO);
```

`logoUrl` comes from `GET /v1/storefront/config` (`identity.logoUrl`), the narrower endpoint `StoreConfigService` reads alongside the runtime config.

## Tests to run

`npx nx test storefront` is the whole storefront Vitest suite and takes ten minutes or more. For this recipe the short equivalent is the second command below, run from `apps/storefront`: it runs only the two brand specs through the same `apps/storefront/vite.config.ts` and finishes in under a minute.

```bash
npx nx test common
cd apps/storefront && npx vitest run src/styles/brand-tokens.spec.ts src/app/services/brand-tokens.service.spec.ts
npx nx test storefront
npx nx run storefront:verify-font-subsets
npx nx e2e storefront-e2e --grep=store-config
STORE_CONFIG_FIXTURE=gulf-rtl npx nx e2e storefront-e2e --grep=layout-shell
STORE_CONFIG_FIXTURE=maghreb-ltr npx nx e2e storefront-e2e --grep=price-tax-mention
```

- `npx nx test common` runs `libs/shared/common/src/brand/palette.spec.ts`, the contrast proof for the generator on hostile inputs.
- The `vitest run` line runs `apps/storefront/src/styles/brand-tokens.spec.ts` (raw-colour sweep, fallback pinned to the generator) and `apps/storefront/src/app/services/brand-tokens.service.spec.ts` (the injected block) and nothing else. `npx nx test storefront` runs the same two inside the full suite; use it once before you commit.
- `verify-font-subsets` checks every face in both kits still covers the codepoints a price and an Arabic page need.
- The e2e lines run the Playwright suite under one scenario fixture each. `STORE_CONFIG_FIXTURE` is read by `scripts/seed-storefront-test.ts` in global setup and seeds the fixture's config into the test database; `demo` is the default. On PowerShell set it with `$env:STORE_CONFIG_FIXTURE='gulf-rtl'` before the command.

## Gotchas

- The three fixtures in `test/fixtures/store-configs/` are the only reference values. `gulf-rtl` is the RTL gate (Arabic default, `arabic-latin` kit, symbol before the number). `maghreb-ltr` is the three-decimal money gate and the longer-copy gate (French default). `demo` is what the visual-regression baselines were recorded under, so run `visual-regression.journey.spec.ts` under `demo` or expect diffs.
- `brand.generatedPalette` is not in the fixture files. It is derived from `baseColors` when the config is written, and unit specs get it through `apps/storefront/src/test-support/store-config-fixtures.ts`, which calls the generator.
- `brand-tokens.spec.ts` also fails on a token that is consumed but declared nowhere. Declare a new token in `brand.css` before using it in a component.
- The injected block is one inline `<style>`. `apps/storefront/src/server/middleware/security-headers.ts` sends `style-src 'self' 'unsafe-inline'`, so no nonce is involved; do not tighten that directive without moving the block.
- The server config read is cached per process for sixty seconds in `apps/storefront/src/server/store-config.ts`, and the API caches the same payload. An admin save shows up on the storefront within about a minute, not instantly. `store-config.journey.spec.ts` polls for up to seventy-five seconds for this reason.
- `theme-color` is rewritten by `applyThemeColor()` from `--brand-primary` on the server pass only. The static value in `apps/storefront/index.html` is what an unconfigured store shows.
- A config that enables `ar` must select a kit whose scripts include Arabic. The config schema enforces it; the storefront does not swap faces per locale.
