import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { BRAND_TOKEN_KEYS } from '@common/brand';

import { provideFixtureStoreConfig } from '../../test-support/store-config-fixtures';
import { BRAND_TOKENS_STYLE_ID, BrandTokensService } from './brand-tokens.service';
import { StoreConfigService } from './store-config.service';

/**
 * The token block is the whole brand of an install, so the assertions below
 * are about completeness and about the two ways it could go wrong at runtime:
 * rendered twice, or rendered on the browser pass over a document that
 * already carries it.
 */

function build(platform: 'server' | 'browser', fixture: 'demo' | 'gulf-rtl' = 'demo') {
  TestBed.configureTestingModule({
    providers: [{ provide: PLATFORM_ID, useValue: platform }, provideFixtureStoreConfig(fixture)],
  });
  const document = TestBed.inject(DOCUMENT);
  document.getElementById(BRAND_TOKENS_STYLE_ID)?.remove();
  return { service: TestBed.inject(BrandTokensService), document };
}

describe('BrandTokensService', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('renders every declared token into a :root block on the server pass', () => {
    const { service, document } = build('server');

    service.apply();

    const style = document.getElementById(BRAND_TOKENS_STYLE_ID);
    expect(style).not.toBeNull();
    const css = style?.textContent ?? '';
    expect(css.startsWith(':root {')).toBe(true);
    for (const token of BRAND_TOKEN_KEYS) {
      expect(css).toContain(`${token}: #`);
    }
  });

  it('binds the font families of the configured kit', () => {
    // The kit is a config value, so the families cannot live in the stylesheet.
    const latin = build('server', 'demo');
    latin.service.apply();
    expect(latin.document.getElementById(BRAND_TOKENS_STYLE_ID)?.textContent).toContain(
      "--brand-kit-display: 'Baloo 2';",
    );

    TestBed.resetTestingModule();
    const arabic = build('server', 'gulf-rtl');
    arabic.service.apply();
    const css = arabic.document.getElementById(BRAND_TOKENS_STYLE_ID)?.textContent ?? '';
    expect(css).toContain("--brand-kit-display: 'Cairo';");
    // Inter follows Tajawal: Tajawal carries no U+2000-206F punctuation, and
    // CSS falls back per glyph, so a grouped price still finds a face.
    expect(css).toContain("--brand-kit-body: 'Tajawal', 'Inter';");
  });

  it('carries the type scale of the configured kit, not one scale for both', () => {
    // `agent_docs/storefront/brand-tokens.md` gives each kit its own scale,
    // calibrated to its faces. Shipping one scale rendered the other kit at
    // the wrong sizes, which is what the E2 brand audit caught.
    const latin = build('server', 'demo');
    latin.service.apply();
    const latinCss = latin.document.getElementById(BRAND_TOKENS_STYLE_ID)?.textContent ?? '';
    expect(latinCss).toContain('--brand-text-display: 40px;');
    expect(latinCss).toContain('--brand-text-section: 24px;');
    expect(latinCss).toContain('--brand-text-micro: 12px;');

    TestBed.resetTestingModule();
    const arabic = build('server', 'gulf-rtl');
    arabic.service.apply();
    const arabicCss = arabic.document.getElementById(BRAND_TOKENS_STYLE_ID)?.textContent ?? '';
    expect(arabicCss).toContain('--brand-text-display: 48px;');
    expect(arabicCss).toContain('--brand-text-section: 20px;');
    expect(arabicCss).toContain('--brand-text-micro: 13px;');
  });

  it('falls back to the kit that covers the default locale script, not a fixed one', () => {
    const palette = { tokens: { '--brand-primary': '#1f6f8b' } };
    const withDefault = (defaultLocale: string) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: PLATFORM_ID, useValue: 'browser' },
          {
            provide: StoreConfigService,
            useValue: {
              brand: () => ({ generatedPalette: palette, fontKit: 'unknown-kit' }),
              localization: () => ({ defaultLocale }),
            },
          },
        ],
      });
      return TestBed.inject(BrandTokensService).cssText() ?? '';
    };

    expect(withDefault('ar')).toContain("--brand-kit-display: 'Cairo';");
    expect(withDefault('fr')).toContain("--brand-kit-display: 'Baloo 2';");
  });

  it('renders the palette of the active config, not a build-time one', () => {
    const { service, document } = build('server', 'gulf-rtl');

    service.apply();

    const css = document.getElementById(BRAND_TOKENS_STYLE_ID)?.textContent ?? '';
    // The gulf fixture's primary seed. It reaches the page unchanged because
    // it already clears every floor the generator holds a seed to.
    expect(css).toContain('--brand-primary: #1f6f8b;');
  });

  it('appends one block however many times it runs', () => {
    const { service, document } = build('server');

    service.apply();
    service.apply();

    expect(document.querySelectorAll(`#${BRAND_TOKENS_STYLE_ID}`).length).toBe(1);
  });

  it('writes nothing on the browser pass, where the document already carries it', () => {
    // A second block would double every declaration and make the cascade
    // depend on execution order.
    const { service, document } = build('browser');

    service.apply();

    expect(document.getElementById(BRAND_TOKENS_STYLE_ID)).toBeNull();
  });

  it('still composes the css text on the browser, for a caller that wants it', () => {
    const { service } = build('browser');
    expect(service.cssText()).toContain('--brand-bg:');
  });
});
