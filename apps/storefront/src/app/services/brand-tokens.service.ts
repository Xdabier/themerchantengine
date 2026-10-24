import { DOCUMENT, isPlatformServer } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';

import {
  FONT_KITS as REGISTRY_FONT_KITS,
  fontKitCoversLocale,
} from '@common/locale/locale-registry';

import { StoreConfigService } from './store-config.service';

/**
 * Writes the store's brand tokens into the document head (plan E2.2).
 *
 * The engine ships one build for every install, so the palette cannot live in
 * a stylesheet. It is generated from the operator's base colours and served on
 * `GET /v1/store/config`, and this is where it becomes CSS.
 *
 * On the server pass the block is rendered into the SSR HTML, before the first
 * paint, so a visitor never sees the fallback palette flash to the real one.
 * On the browser pass the block is already in the document that hydrated, so
 * this does nothing: writing a second one would double a declaration for no
 * gain and make the cascade depend on execution order.
 *
 * An inline `<style>` rather than a linked sheet because the values are
 * per-store, not per-build, and a linked sheet would be one more blocking
 * round trip for a dozen custom properties. `style-src` already allows inline
 * styles (`server/middleware/security-headers.ts`), so no nonce is involved.
 *
 * `brand.css` still declares the same tokens with the neutral palette, and
 * this block overrides them by cascade order. That is what keeps a page
 * rendering when the config read failed.
 */

export const BRAND_TOKENS_STYLE_ID = 'brand-tokens';

/**
 * The two allowlisted font kits: the families each binds to the family tokens,
 * and the type scale calibrated to those faces.
 *
 * Both kits ship in every build (their faces are declared in `global.css`) and
 * the config selects one. A browser downloads only the faces the selected
 * families use, so carrying both costs nothing on the wire, and the
 * alternative was a per-install build.
 */
interface FontKit {
  display: string;
  body: string;
  /**
   * The type scale, in the order `agent_docs/storefront/brand-tokens.md`
   * lists it in the kit table: display, display-mobile, section, product,
   * price, body, secondary, micro.
   *
   * It belongs to the kit because it is calibrated to the faces: Cairo and
   * Tajawal carry a smaller apparent x-height at the same pixel size than
   * Baloo 2 and Inter, so the Arabic kit takes a larger display step and a
   * smaller body step to read at the same weight on the page. A single scale
   * across both kits renders one of them wrong, which is what shipped until
   * the brand auditor caught it at the E2 gate.
   */
  scale: {
    display: string;
    displayMobile: string;
    section: string;
    product: string;
    price: string;
    body: string;
    secondary: string;
    micro: string;
  };
}

export const FONT_KITS: Record<string, FontKit> = {
  'latin-rounded': {
    display: "'Baloo 2'",
    body: "'Inter'",
    scale: {
      display: '40px',
      displayMobile: '32px',
      section: '24px',
      product: '19px',
      price: '19px',
      body: '16px',
      secondary: '14px',
      micro: '12px',
    },
  },
  'arabic-latin': {
    display: "'Cairo'",
    // Inter follows Tajawal, which carries Arabic and Latin letters but not
    // the U+2000-206F punctuation a grouped price uses. CSS falls back per
    // glyph, so the separator finds Inter without the Arabic text leaving
    // Tajawal.
    body: "'Tajawal', 'Inter'",
    scale: {
      display: '48px',
      displayMobile: '32px',
      section: '20px',
      product: '18px',
      price: '18px',
      body: '16px',
      secondary: '13px',
      micro: '13px',
    },
  },
};

@Injectable({ providedIn: 'root' })
export class BrandTokensService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly storeConfig = inject(StoreConfigService);

  /** The `:root` block for the resolved palette, or null when there is none. */
  cssText(): string | null {
    const brand = this.storeConfig.brand();
    const palette = brand.generatedPalette;
    if (!palette) return null;
    const kit = FONT_KITS[brand.fontKit] ?? this.kitForDefaultLocale();
    const declarations = [
      ...Object.entries(palette.tokens).map(([token, value]) => `  ${token}: ${value};`),
      `  --brand-kit-display: ${kit.display};`,
      `  --brand-kit-body: ${kit.body};`,
      `  --brand-text-display: ${kit.scale.display};`,
      `  --brand-text-display-mobile: ${kit.scale.displayMobile};`,
      `  --brand-text-section: ${kit.scale.section};`,
      `  --brand-text-product: ${kit.scale.product};`,
      `  --brand-text-price: ${kit.scale.price};`,
      `  --brand-text-body: ${kit.scale.body};`,
      `  --brand-text-secondary: ${kit.scale.secondary};`,
      `  --brand-text-micro: ${kit.scale.micro};`,
    ].join('\n');
    return `:root {\n${declarations}\n}`;
  }

  /** First registry kit whose scripts cover the store's default locale. */
  private kitForDefaultLocale(): FontKit {
    const code = this.storeConfig.localization().defaultLocale;
    const name = REGISTRY_FONT_KITS.find((candidate) => fontKitCoversLocale(candidate, code));
    return FONT_KITS[name ?? REGISTRY_FONT_KITS[0]];
  }

  /**
   * Render the block into the head. Server pass only, and once.
   *
   * Idempotent on the id rather than on a flag, because the document is the
   * shared state here: a second bootstrap in the same server process must not
   * append a second block.
   */
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

  /**
   * Browser chrome reads `theme-color` before any stylesheet loads, so it is
   * the one colour a token cannot reach. The static value in `index.html` is
   * what an unconfigured store shows; this rewrites it to the install's own.
   */
  private applyThemeColor(): void {
    const primary = this.storeConfig.brand().generatedPalette?.tokens['--brand-primary'];
    if (!primary) return;
    const meta = this.document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', primary);
  }
}
