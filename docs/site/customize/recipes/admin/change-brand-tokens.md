---
title: Change brand tokens
description: "Which colours in the Angular admin come from the store's settings at runtime and which are the admin's own build-time design tokens, how dark and light mode resolve, and the contrast gate that measures every pair."
primaryQuery: change brand tokens tailwind angular admin dashboard dark mode
updated: 2026-09-09
schema: HowTo
---

## When you need this

You want the admin to look different, and you need to know which of two layers you are editing. The store's identity (name, logo) is runtime data the admin fetches from the settings endpoint and renders in its chrome. The admin's palette, semantic tokens, fonts and radius are build-time tokens in two files, checked by three specs. The store's own brand colours are edited under Settings and rendered by the storefront; the admin never paints itself with them. You end up knowing which file to touch for each, and which test tells you when a change breaks a floor.

## Files you touch

- `apps/admin/src/app/core/stores/store-settings.store.ts`: the runtime layer. Reads `GET /v1/admin/settings` and exposes `storeName`, `logoUrl` and the locale tabs.
- `apps/admin/src/app/shared/layouts/app-shell.component.ts` and `libs/admin-ui/src/organisms/topbar/topbar.component.ts`: where the store identity renders.
- `apps/admin/src/styles.css`: the palette (hex) and the semantic layer (RGB channels), in three blocks: dark, system light, explicit light.
- `apps/admin/tailwind.config.js`: exposes the semantic layer as utilities and disables gradients, rings and radius.
- `apps/admin/src/index.html`: the colour-mode boot script and the only hex literals allowed outside CSS.
- `apps/admin/src/app/core/stores/theme.store.ts` and `apps/admin/src/app/shared/layouts/topbar-theme-toggle.component.ts`: the mode preference and its switch.
- `apps/admin/src/brand-tokens.spec.ts`, `apps/admin/src/palette-token.guard.spec.ts`, `apps/admin/src/theme-boot.spec.ts`: the structural guards.
- `apps/admin-e2e/src/modules/contrast-probe.spec.ts`: the contrast gate, in both modes.

## The pattern

### 1. The runtime layer: store identity, not store colours

The admin does not call `GET /v1/store/config`. Only the domains settings page mentions it, in a comment explaining that the origins it edits feed that public endpoint for the storefront. What the chrome renders comes from `apps/admin/src/app/core/stores/store-settings.store.ts`, which calls the same `SettingsService.getAll()` every settings screen uses and keeps the ambient values in signals:

```ts
  private readonly _storeName = signal<Translatable | string | null>(null);
  private readonly _logoUrl = signal<string | null>(null);

  readonly storeName = computed(() => pickTranslation(this._storeName(), this.defaultLocale(), ''));
  readonly logoUrl = this._logoUrl.asReadonly();
```

```ts
        this._storeName.set(readStoreName(groups));
        this._logoUrl.set(readString(groups['appearance']?.['logoUrl']));
```

`apps/admin/src/app/shared/layouts/app-shell.component.ts` hands them to the topbar:

```ts
  /** The store's identity, from the settings the admin already fetches. */
  readonly storeName = this.settings.storeName;
  readonly storeLogoUrl = this.settings.logoUrl;
```

`libs/admin-ui/src/organisms/topbar/topbar.component.ts` renders both in the muted ink, on desktop only, and falls back to the engine's name:

```html
<span class="truncate" [title]="storeName()" data-testid="topbar-store-name"
  >{{ storeName() || 'merchants-engine' }} · admin</span
>
```

The store's base colours (`/settings/brand`) go through `generatePalette` for the storefront. `apps/admin/src/app/features/settings/settings-brand.page.ts` is the only file under `apps/admin/src/app` that calls it, and it uses the result for the preview on that screen. The admin's own surfaces never read them.

### 2. The build-time layer: palette and semantic tokens

`apps/admin/src/styles.css` declares the palette as hex on `:root`:

```css
:root {
  --color-void-black: #0a0a0a;
  --color-paper-white: #e8e4df;
  --color-pure-white: #ffffff;
  --color-engine-accent: #ff3b00;
  --color-neutral-800: #1a1a1a;
  --color-neutral-700: #2a2a2a;
  --color-neutral-500: #6b6b6b;
  --color-neutral-300: #9a9a9a;
  --color-status-success: #2d8659;
  --color-status-warning: #d4760a;
  --color-status-error: #c0392b;
  --color-status-info: #4a90a4;
```

The semantic layer is what components use, declared as space-separated RGB channels so Tailwind's opacity modifiers keep working (`bg-surface-elevated/80` becomes `rgb(26 26 26 / 0.8)`; a hex could not). Dark is the default:

```css
:root,
:root[data-theme='dark'] {
    --scheme: dark;
    --surface: 10 10 10;
    --surface-elevated: 26 26 26;
    --surface-emphasis: 232 228 223;
    --surface-emphasis-hover: 255 255 255;
    --ink: 232 228 223;
    --ink-emphasis: 255 255 255;
    --ink-muted: 154 154 154;
    --ink-disabled: 107 107 107;
    --on-emphasis: 10 10 10;
    --line: 42 42 42;
```

`apps/admin/tailwind.config.js` composes the utilities from those channels and switches the forbidden features off:

```js
const semantic = (name) => `rgb(var(--${name}) / <alpha-value>)`;

      colors: {
        surface: { DEFAULT: semantic('surface'), elevated: semantic('surface-elevated'), emphasis: semantic('surface-emphasis'), 'emphasis-hover': semantic('surface-emphasis-hover') },
        ink: { DEFAULT: semantic('ink'), emphasis: semantic('ink-emphasis'), muted: semantic('ink-muted'), disabled: semantic('ink-disabled') },
        'on-emphasis': semantic('on-emphasis'),
        line: { DEFAULT: semantic('line'), strong: semantic('line-strong') },
        status: statusColors(),
        'on-status': onStatusColors(),
        'void-black': '#0A0A0A',
        'paper-white': '#E8E4DF',
      },
      borderRadius: { DEFAULT: '0', none: '0' },
  corePlugins: {
    ringWidth: false,
    ringColor: false,
    ringOffsetWidth: false,
    ringOffsetColor: false,
    backgroundImage: false, // disables gradients
  },
```

The two layers are not linked. The semantic blocks (`apps/admin/src/styles.css:166-176`) hold channel literals, `42 42 42` for `--line`, and never reference a palette name; `42 42 42` is `#2a2a2a`, which is `--color-neutral-700`, but nothing in the file says so. Editing `--color-neutral-700` changes nothing on screen. To change a colour, convert the target hex to its channels and write those digits into the token in each of the three blocks; components stay untouched, because they only ever say `bg-surface`, `text-ink`, `border-line`. The palette hexes are the reference the semantic values were copied from, and the contrast probe below is what tells you when a new value falls under a floor. Fonts are the `fontFamily` entry in the same config (Satoshi, JetBrains Mono); radius stays `0` because `styles.css` also resets it on every element under `@layer base` with `!important`.

### 3. Light and dark mode

Three blocks, and the order matters. Dark sits on bare `:root`. System light is a media query scoped away from an explicit dark choice. Explicit light comes last so a manual choice wins in both directions:

```css
@media (prefers-color-scheme: light) {
  :root:not([data-theme='dark']) {
    --scheme: light;
    --surface: 232 228 223;
    --surface-elevated: 244 241 237;
    --surface-emphasis: 10 10 10;
    --surface-emphasis-hover: 26 26 26;
```

```css
:root[data-theme='light'] {
```

The attribute is set before first paint by the one inline script in `apps/admin/src/index.html`, which reads the `admin-theme` key from `localStorage` and falls back to the system setting, then dark:

```html
<script>var m='dark';try{var s=localStorage.getItem('admin-theme');m=(s==='dark'||s==='light')?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');}catch(e){}document.documentElement.setAttribute('data-theme',m);var t=document.querySelector('meta[name="theme-color"]');if(t)t.setAttribute('content',m==='light'?'#E8E4DF':'#0A0A0A');</script>
```

Once Angular boots, `apps/admin/src/app/core/stores/theme.store.ts` owns the same key and keeps the attribute in sync:

```ts
export const THEME_STORAGE_KEY = 'admin-theme';

  readonly resolved = computed<ThemeMode>(() => {
    const preference = this._preference();
    if (preference !== 'system') return preference;
    return this._systemPrefersLight() ? 'light' : 'dark';
  });

  constructor() {
    this.watchSystem();
    effect(() => {
      this.document.documentElement.setAttribute('data-theme', this.resolved());
    });
  }
```

The topbar button (`apps/admin/src/app/shared/layouts/topbar-theme-toggle.component.ts`) switches to the other mode and commits it; returning to `system` is not on the button.

### 4. The contrast gate

`apps/admin-e2e/src/modules/contrast-probe.spec.ts` reads the tokens out of the live document's computed style, in both modes, and checks every documented pair against its floor. It does not depend on what happens to be on screen, so a token no screen uses yet is still measured.

```ts
const BODY_FLOOR = 7;
const LARGE_FLOOR = 4.5;

const PAIRS: readonly Pair[] = [
  { text: '--ink', ground: '--surface', floor: BODY_FLOOR },
  { text: '--ink', ground: '--surface-elevated', floor: BODY_FLOOR },
  { text: '--ink-emphasis', ground: '--surface', floor: BODY_FLOOR },
  { text: '--ink-muted', ground: '--surface', floor: LARGE_FLOOR },
  { text: '--on-emphasis', ground: '--surface-emphasis', floor: LARGE_FLOOR },
  ...['success', 'warning', 'error', 'info'].flatMap((status) => [
    { text: `--status-${status}`, ground: '--surface', floor: LARGE_FLOOR },
    { text: `--status-${status}`, ground: '--surface-elevated', floor: LARGE_FLOOR },

for (const mode of ['dark', 'light'] as const) {
  test.describe(`${mode} mode`, () => {
    test(`every documented pair meets its contrast floor`, async ({ page }) => {
```

A pair below its floor is a failed test. Body ink on either surface needs 7:1; muted ink, status ink and text on the emphasis fill need 4.5:1.

## Tests to run

```bash
npx nx test admin
npx nx build admin --configuration=production
npx nx e2e admin-e2e --grep "contrast|light-mode|design-system"
```

- `npx nx test admin` runs three structural guards. `brand-tokens.spec.ts` fails when a token is declared in one mode and not the other, when the two light blocks differ, or when the Tailwind config names a variable `styles.css` does not declare. `palette-token.guard.spec.ts` fails on a palette token or a hex anywhere in `apps/admin/src` or `libs/admin-ui/src` outside the exempt files. `theme-boot.spec.ts` recomputes the CSP hash of the boot script against `apps/admin/security-headers.conf`, and its second describe (lines 65-91) reads `apps/admin/nginx.conf` and asserts that every `location` block includes that headers file, because nginx drops inherited `add_header` lines the moment a location declares its own.
- `npx nx build admin --configuration=production` regenerates the Tailwind output; a new utility name only exists after this.
- The e2e grep runs the contrast probe in both modes, the light-mode screenshot baselines, and the zero-radius check on `/dev/design-system`.

## Gotchas

- The boot script in `index.html` must stay one line. Its CSP hash is pinned in `apps/admin/security-headers.conf`; a newline inside it differs between a CRLF and an LF checkout, so the hash would hold on one machine and fail on the other. `theme-boot.spec.ts` checks both the line count and the hash.
- Two of the guards are red before you change anything on a checkout where git converted line endings (Windows with `core.autocrlf=true`, and no `eol=lf` pin covers these files in `.gitattributes`). `brand-tokens.spec.ts` looks for the selector `":root,\n:root[data-theme='dark']"` with a bare `\n` (line 51) and the throw on line 28 says `styles.css has no ... block`; `theme-boot.spec.ts:84` replaces a `location = /healthz {\n` literal in `nginx.conf`, finds nothing on CRLF, and line 87 fails. Both pass on an LF checkout (`core.autocrlf false`, or a `text eol=lf` attribute for the two files). Read the failure before assuming it is yours.
- The three hex literals in `index.html` (the `theme-color` default and the two the script swaps between) are pinned by convention to `--color-void-black` and `--color-paper-white`. Change either token and edit `index.html` by hand; nothing links them.
- A semantic token must be declared in all three blocks. An undeclared custom property resolves to nothing and the element inherits, which looks like a styling opinion rather than a bug. `brand-tokens.spec.ts` is what catches it.
- Declare semantic tokens as channels, never hex. A hex value makes every `/opacity` modifier on that utility resolve to nothing.
- The two dark status inks (`--color-status-success-ink-dark`, `--color-status-error-ink-dark`) exist because the base success and error hexes fail 4.5:1 as text on Void Black. Remap `--status-success` or `--status-error` to the base hex and the probe fails in dark mode.
- The dialog scrim and `--preview-ground` do not follow the mode on purpose: a scrim sinks the page, and an email preview renders on white wherever it is read.
- The store name and logo render in `--ink-muted`; they never carry the store's palette into the chrome. Painting the admin in the store's colours is new work against the palette guard, not a token change.
