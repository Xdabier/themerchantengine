import * as fs from 'node:fs';
import * as path from 'node:path';

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideZoneChangeDetection, signal } from '@angular/core';
import axe from 'axe-core';
import { beforeEach, describe, expect, it } from 'vitest';

import { CampaignBannerComponent, type CampaignCopy } from './campaign-banner.component';
import { LocaleService } from '../../locale.service';
import type { Locale } from '../../../i18n/types';

class FakeLocaleService {
  readonly _locale = signal<Locale>('fr');
  readonly locale = this._locale.asReadonly();
  readonly currentUrl = signal('/fr/').asReadonly();
}

const COPY: CampaignCopy = {
  eyebrow: 'Rotatif',
  headline: 'Contre-angles bague bleue',
  body: 'Livré sous 48 h, où que vous soyez.',
  cta: 'Voir la gamme',
  ctaLink: { kind: 'internal', href: '/fr/catalog/contre-angles' },
  imageAlt: 'Contre-angle sur fond blanc',
  imageUrl: null,
};

// Several tests render twice (with and without an asset, band and quiet), so
// the module is reset per render rather than only per test.
function setup(copy: CampaignCopy = COPY, tone: 'band' | 'quiet' = 'band') {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CampaignBannerComponent],
    providers: [
      provideZoneChangeDetection({ eventCoalescing: true }),
      provideRouter([]),
      { provide: LocaleService, useValue: new FakeLocaleService() },
    ],
  });
  const fixture = TestBed.createComponent(CampaignBannerComponent);
  fixture.componentRef.setInput('copy', copy);
  fixture.componentRef.setInput('tone', tone);
  fixture.detectChanges();
  return { fixture };
}

const source = () => fs.readFileSync(path.join(__dirname, 'campaign-banner.component.ts'), 'utf8');

describe('CampaignBannerComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('renders the operator copy', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="home-promo-banner"]')).not.toBeNull();
    expect(root.querySelector('.headline')?.textContent?.trim()).toBe(COPY.headline);
    expect(root.querySelector('.eyebrow')?.textContent?.trim()).toBe(COPY.eyebrow);
    expect(root.querySelector('.body')?.textContent?.trim()).toBe(COPY.body);
  });

  it('routes the CTA at the resolved link', () => {
    const { fixture } = setup();
    const cta = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="home-promo-banner-cta"]',
    );
    expect(cta?.getAttribute('href')).toBe('/fr/catalog/contre-angles');
  });

  it('renders an external CTA as a plain anchor carrying rel=noopener', () => {
    const { fixture } = setup({
      ...COPY,
      ctaLink: { kind: 'external', href: 'https://example.com/x' },
    });
    const cta = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="home-promo-banner-cta"]',
    );
    expect(cta?.getAttribute('href')).toBe('https://example.com/x');
    expect(cta?.getAttribute('rel')).toBe('noopener');
  });

  it('renders no CTA anchor when the label is empty (S2)', () => {
    const { fixture } = setup({ ...COPY, cta: '' });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="home-promo-banner-cta"]')).toBeNull();
    expect(root.querySelector('.cta')).toBeNull();
  });

  it('renders the product asset when one is configured, and nothing when not', () => {
    const without = setup().fixture.nativeElement as HTMLElement;
    expect(without.querySelector('[data-testid="home-promo-banner-media"]')).toBeNull();

    const { fixture } = setup({ ...COPY, imageUrl: 'https://cdn/promo-800.webp' });
    const media = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="home-promo-banner-media"]',
    );
    expect(media?.querySelector('img')?.getAttribute('src')).toBe('https://cdn/promo-800.webp');
    // Product-on-white per §5.1, so the asset is content and carries its alt.
    expect(media?.querySelector('img')?.getAttribute('alt')).toBe(COPY.imageAlt);
  });

  it('fills the band with the primary only in the band tone', () => {
    // the primary never exceeds 15 percent of a surface and a large flat fill is
    // reserved for a single banner per page. A second banner therefore renders
    // on a neutral surface instead, so data alone cannot put the page in a failing state.
    const band = setup(COPY, 'band').fixture.nativeElement as HTMLElement;
    expect(band.querySelector('.banner')?.classList.contains('banner--band')).toBe(true);
    const quiet = setup(COPY, 'quiet').fixture.nativeElement as HTMLElement;
    expect(quiet.querySelector('.banner')?.classList.contains('banner--band')).toBe(false);
  });

  it('carries no lifestyle backdrop, scrim or gradient (agent_docs/storefront/brand-tokens.md)', () => {
    expect(source()).not.toContain('--brand-scrim');
    expect(source()).not.toContain('linear-gradient');
    expect(source()).not.toContain('background-image');
  });

  it('shouts nowhere and uses no state colour for promotion (§8.2)', () => {
    expect(source()).not.toContain('text-transform: uppercase');
    expect(source()).not.toContain('--brand-success');
    expect(source()).not.toContain('--brand-warning');
    expect(source()).not.toContain('--brand-error');
  });

  it('grounds small inverse text on the pressed primary step', () => {
    // Inverse text on the primary fails AA below 16 px, so the CTA inside the band must
    // sit on the darker step rather than on the band colour.
    const rule = /\.banner--band\s+\.cta\s*\{[^{}]*\}/.exec(source());
    expect(rule, 'no .banner--band .cta rule found').not.toBeNull();
    expect(rule![0]).toContain('--brand-primary-dark');
  });

  it('grounds the 12 px band eyebrow on the pressed primary step too', () => {
    // brand-auditor blocker, 2026-08-29: white under 16 px must never sit on
    // the raw primary. The eyebrow is 12 px (--brand-text-micro), so inside the
    // band it needs its own appuyée ground rather than inheriting the fill.
    const rule = /\.banner--band\s+\.eyebrow\s*\{[^{}]*\}/.exec(source());
    expect(rule, 'no .banner--band .eyebrow rule found').not.toBeNull();
    expect(rule![0]).toContain('background-color: var(--brand-primary-dark)');
  });

  it('honours the reduced-motion preference (agent_docs/storefront/brand-tokens.md)', () => {
    expect(source()).toContain('prefers-reduced-motion: reduce');
  });

  it('passes axe-core WCAG 2.2 AA in the band tone', async () => {
    const { fixture } = setup();
    const result = await axe.run(fixture.nativeElement, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      rules: {
        region: { enabled: false },
        'landmark-one-main': { enabled: false },
        'page-has-heading-one': { enabled: false },
      },
    });
    const blocking = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});
