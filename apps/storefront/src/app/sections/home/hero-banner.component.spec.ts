import * as fs from 'node:fs';
import * as path from 'node:path';

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideZoneChangeDetection, signal } from '@angular/core';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { HeroBannerComponent, type HeroCopy } from './hero-banner.component';
import { LocaleService } from '../../locale.service';
import type { Locale } from '../../../i18n/types';

class FakeLocaleService {
  readonly _locale = signal<Locale>('fr');
  readonly _url = signal('/fr/');
  readonly locale = this._locale.asReadonly();
  readonly currentUrl = this._url.asReadonly();
  set(locale: Locale, url: string) {
    this._locale.set(locale);
    this._url.set(url);
  }
}

function setup(copy: HeroCopy, locale: Locale = 'fr') {
  const fakeLocale = new FakeLocaleService();
  fakeLocale.set(locale, locale === 'fr' ? '/fr/' : '/en/');
  TestBed.configureTestingModule({
    imports: [HeroBannerComponent],
    providers: [
      provideZoneChangeDetection({ eventCoalescing: true }),
      provideRouter([]),
      { provide: LocaleService, useValue: fakeLocale },
    ],
  });
  const fixture = TestBed.createComponent(HeroBannerComponent);
  fixture.componentRef.setInput('copy', copy);
  fixture.detectChanges();
  return { fixture };
}

/** Hero row with no asset: the component degrades to copy alone on the primary. */
const COPY_NO_PHOTO: HeroCopy = {
  eyebrow: 'Demo Store',
  headline: 'Le juste prix, livré.',
  body: 'Le catalogue complet, en stock et livré.',
  cta: 'Voir le catalogue',
  ctaLink: { kind: 'internal', href: '/fr/catalog' },
  imageAlt: 'Instruments dentaires disposés sur un fond blanc',
  imageUrl: null,
};

const COPY_WITH_PHOTO: HeroCopy = {
  eyebrow: 'New season',
  headline: 'Headline copy',
  body: 'Body copy.',
  cta: 'Shop',
  ctaLink: { kind: 'internal', href: '/en/catalog' },
  imageAlt: 'Composite resin syringe on a white ground',
  imageUrl: '/uploads/hero-1600.jpg',
  imageSources: [
    { type: 'image/avif', srcset: '/uploads/hero-800.avif 800w, /uploads/hero-1600.avif 1600w' },
    { type: 'image/webp', srcset: '/uploads/hero-800.webp 800w, /uploads/hero-1600.webp 1600w' },
  ],
};

/** The component's own source, for the style-block assertions below. */
const source = () => fs.readFileSync(path.join(__dirname, 'hero-banner.component.ts'), 'utf8');

describe('HeroBannerComponent', () => {
  it('renders the operator copy from the HERO row verbatim', () => {
    const { fixture } = setup(COPY_NO_PHOTO, 'fr');
    const root = fixture.nativeElement as HTMLElement;
    // Brand floor §1: the final period is part of the signature and is never
    // removed. Operator decision on 2026-08-23 is that the rule binds the words,
    // not only the vector artwork, so the headline carries it too.
    expect(root.querySelector('.headline')?.textContent?.trim()).toBe(COPY_NO_PHOTO.headline);
    expect(root.querySelector('.eyebrow')?.textContent?.trim()).toBe(COPY_NO_PHOTO.eyebrow);
    expect(root.querySelector('.body')?.textContent?.trim()).toBe(COPY_NO_PHOTO.body);
  });

  it('carries no locale-keyed fallback copy of its own', () => {
    // B1 retired the flag-off legacy home. A baked headline here would render
    // stale brand copy the operator cannot edit, so assert the source is clean.
    expect(source()).not.toContain('LEGACY_HERO_COPY');
    expect(source()).not.toContain('Fair prices, delivered.');
  });

  it('degrades to copy alone on the primary ground when no image is configured', () => {
    const { fixture } = setup(COPY_NO_PHOTO, 'fr');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="home-hero-media"]')).toBeNull();
    expect(root.querySelector('app-picture')).toBeNull();
    expect(root.querySelector('.hero')?.classList.contains('hero--with-image')).toBe(false);
  });

  it('renders the operator product shot as a 1:1 square beside the copy', () => {
    const { fixture } = setup(COPY_WITH_PHOTO, 'en');
    const root = fixture.nativeElement as HTMLElement;
    const media = root.querySelector('[data-testid="home-hero-media"]');
    expect(media).toBeTruthy();
    expect(root.querySelector('.hero')?.classList.contains('hero--with-image')).toBe(true);
    const picture = media?.querySelector('picture') as HTMLElement | null;
    expect(picture?.style.aspectRatio).toContain('1');
    const img = media?.querySelector('img');
    expect(img?.getAttribute('alt')).toBe(COPY_WITH_PHOTO.imageAlt);
    // Largest contentful paint element, so it stays eager + high priority.
    expect(img?.getAttribute('loading')).toBe('eager');
    expect(img?.getAttribute('fetchpriority')).toBe('high');
  });

  it('carries no photographic backdrop and no scrim', () => {
    const { fixture } = setup(COPY_WITH_PHOTO, 'en');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.backdrop')).toBeNull();
    expect(root.querySelector('[data-testid="home-hero-scrim"]')).toBeNull();
    // Brand floor §5.3 deletes the lifestyle tier, so the scrim token has no
    // consumer here any more.
    expect(source()).not.toContain('--brand-scrim-photographic');
  });

  it('routes the CTA at the resolved internal link, not a hardcoded catalog path', () => {
    const { fixture } = setup(
      { ...COPY_WITH_PHOTO, ctaLink: { kind: 'internal', href: '/en/catalog/rotary' } },
      'en',
    );
    const cta = fixture.nativeElement.querySelector(
      '[data-testid="home-hero-cta"]',
    ) as HTMLAnchorElement;
    expect(cta.getAttribute('href')).toBe('/en/catalog/rotary');
    expect(cta.getAttribute('aria-label')).toBe('Shop, Headline copy');
  });

  it('renders an external CTA as a plain anchor carrying rel=noopener', () => {
    const { fixture } = setup(
      { ...COPY_WITH_PHOTO, ctaLink: { kind: 'external', href: 'https://example.com/x' } },
      'en',
    );
    const cta = fixture.nativeElement.querySelector(
      '[data-testid="home-hero-cta"]',
    ) as HTMLAnchorElement;
    expect(cta.getAttribute('href')).toBe('https://example.com/x');
    expect(cta.getAttribute('rel')).toBe('noopener');
  });

  it('renders no CTA anchor at all when the label is empty', () => {
    // S2: an empty label used to render a white pill with no text and no
    // destination. The rule binds the hero as well as the promotional banner.
    const { fixture } = setup({ ...COPY_WITH_PHOTO, cta: '' }, 'en');
    expect(fixture.nativeElement.querySelector('[data-testid="home-hero-cta"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.cta')).toBeNull();
  });

  it('binds the picture sources from imageSources for variant negotiation', () => {
    const { fixture } = setup(COPY_WITH_PHOTO, 'en');
    const sources = Array.from(
      fixture.nativeElement.querySelectorAll('.media source'),
    ) as HTMLSourceElement[];
    const types = sources.map((s) => s.getAttribute('type'));
    expect(types).toContain('image/avif');
    expect(types).toContain('image/webp');
  });

  it('gives the page title the display family and the 32 to 40 step', () => {
    const rule = /\.headline\s*\{[^{}]*\}/.exec(source());
    expect(rule, 'no .headline rule found').not.toBeNull();
    expect(rule![0]).toContain('font-family: var(--brand-font-display)');
    expect(rule![0]).toContain(
      'clamp(var(--brand-text-display-mobile), 4vw, var(--brand-text-display))',
    );
    expect(rule![0]).toContain('font-weight: 700');
  });

  it('shouts nowhere, per brand floor §8.2', () => {
    expect(source()).not.toContain('text-transform: uppercase');
  });

  it('passes axe-core WCAG 2.2 AA at the component scope', async () => {
    const { fixture } = setup(COPY_WITH_PHOTO, 'en');
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
