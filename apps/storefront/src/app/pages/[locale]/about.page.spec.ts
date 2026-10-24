import { ChangeDetectionStrategy, signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocaleService } from '../../locale.service';
import { type Locale } from '../../../i18n/types';
import { ogLocaleFromLocale } from '../../../lib/locale-region';
import { META_TITLE_SEPARATOR } from '../../../lib/seo';
import { getChromeStrings } from '../../../i18n';
import AboutPage from './about.page';
import type { AboutLoadPayload } from './about.server';
import { STOREFRONT_API_CLIENT, type ApiClient } from '@storefront-services';
import {
  fixtureRuntimeConfig,
  provideFixtureStoreConfig,
  fixtureChromeIdentity,
} from '../../../test-support/store-config-fixtures';

/** The scenario config every page spec renders under. */
const SEO_LOCALES = {
  supportedLocales: fixtureRuntimeConfig('maghreb-ltr').localization.supportedLocales,
  defaultLocale: fixtureRuntimeConfig('maghreb-ltr').localization.defaultLocale,
  country: fixtureRuntimeConfig('maghreb-ltr').identity.address.country,
};

/** The about page reads the store config, which injects the API client. */
const noopApi = { get: async () => ({}) } as unknown as ApiClient;

class StubLocaleService {
  private readonly _locale: WritableSignal<Locale>;
  constructor(initial: Locale) {
    this._locale = signal<Locale>(initial);
  }
  readonly locale = () => this._locale();
  readonly chromeIdentity = () => fixtureChromeIdentity('demo', this._locale());
  readonly strings = () => getChromeStrings(this._locale(), this.chromeIdentity());
}

/**
 * SH5 — build the page-server-endpoint payload that `injectLoad<typeof load>()`
 * resolves to in production. The component reads `loaded` synchronously via
 * `toSignal(injectLoad<typeof load>(), { requireSync: true })`, which subscribes
 * to `ActivatedRoute.data` and projects `data['load']`.
 */
function buildLoadPayload(overrides: Partial<AboutLoadPayload['page']> = {}): AboutLoadPayload {
  return {
    page: {
      id: 'cms-about',
      slug: '/about',
      type: 'STATIC',
      title: 'About Us',
      content:
        'Demo Store is an online marketplace. Curated products, transparent pricing, reliable delivery.',
      metaTitle: null,
      metaDescription: null,
      ...overrides,
    },
  };
}

async function renderAbout(
  locale: Locale,
  payload: AboutLoadPayload = buildLoadPayload(),
): Promise<ComponentFixture<AboutPage>> {
  TestBed.overrideComponent(AboutPage, {
    set: { changeDetection: ChangeDetectionStrategy.Default },
  });
  TestBed.configureTestingModule({
    providers: [
      // The scenario config these specs assert their hreflang and money against.
      provideFixtureStoreConfig('maghreb-ltr'),
      provideRouter([]),
      { provide: LocaleService, useValue: new StubLocaleService(locale) },
      // The page reads the operator-configured identity for its Organization
      // JSON-LD, which reaches the API client through StoreConfigService.
      { provide: STOREFRONT_API_CLIENT, useValue: noopApi },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap({}),
            queryParamMap: convertToParamMap({}),
            data: { load: payload },
          },
          paramMap: of(convertToParamMap({})),
          queryParamMap: of(convertToParamMap({})),
          data: of({ load: payload }),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(AboutPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

// The store the stub renders, not the neutral one: the page title's suffix
// is the configured store name now (plan E2.5).
const BRAND = fixtureChromeIdentity('demo', 'en').storeName;

describe('AboutPage', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  it('renders the CMS-backed heading + body in French', async () => {
    const fixture = await renderAbout(
      'fr',
      buildLoadPayload({
        title: 'À propos',
        content:
          'Boutique Démo fournit un catalogue complet aux professionnels. Prix affichés, stock réel, livraison annoncée.',
      }),
    );
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#about-heading')?.textContent?.trim()).toBe('À propos');
    const body = root.querySelector('.body')?.textContent?.trim() ?? '';
    expect(body.length).toBeGreaterThan(40);
    expect(body).toContain('Boutique Démo');
  });

  it('renders the CMS-backed heading + body in English', async () => {
    const fixture = await renderAbout('en');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#about-heading')?.textContent?.trim()).toBe('About Us');
    const body = root.querySelector('.body')?.textContent?.trim() ?? '';
    expect(body.length).toBeGreaterThan(40);
    expect(body).toContain('Demo Store');
  });

  it('renders a <section> with implicit region role (LayoutShell owns the <main> landmark)', async () => {
    const fixture = await renderAbout('en');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('main')).toBeNull();
    const section = root.querySelector('section');
    expect(section).not.toBeNull();
    expect(section?.getAttribute('aria-labelledby')).toBe('about-heading');
  });

  it('uses CMS metaTitle / metaDescription when present', async () => {
    await renderAbout(
      'en',
      buildLoadPayload({
        title: 'About Us',
        metaTitle: 'About — the store (custom meta)',
        metaDescription: 'Custom meta description for the about page (≤160 char).',
      }),
    );
    // Every CMS-backed title ends in the brand, via titleWithBrand.
    expect(document.title).toBe(`About — the store (custom meta)${META_TITLE_SEPARATOR}${BRAND}`);
    const desc = document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
    expect(desc).toContain('Custom meta description');
  });

  it('falls back to title + body excerpt when CMS meta fields are null', async () => {
    await renderAbout(
      'en',
      buildLoadPayload({ title: 'About Us', metaTitle: null, metaDescription: null }),
    );
    expect(document.title).toBe(`About Us${META_TITLE_SEPARATOR}${BRAND}`);
    const desc = document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
    expect(desc.length).toBeGreaterThan(0);
    expect(desc.length).toBeLessThanOrEqual(200);
  });

  it('passes axe-core WCAG 2.2 AA at the component scope', async () => {
    const fixture = await renderAbout('en');
    const result = await axe.run(fixture.nativeElement, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      rules: {
        'landmark-one-main': { enabled: false },
        region: { enabled: false },
      },
    });
    const blocking = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  it('emits og:* and twitter:* tags wired to the locale + path', async () => {
    await renderAbout('fr', buildLoadPayload({ title: 'À propos', content: 'Qui sommes-nous.' }));
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toContain(
      'À propos',
    );
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toContain(
      '/fr/about',
    );
    expect(document.querySelector('meta[property="og:locale"]')?.getAttribute('content')).toBe(
      ogLocaleFromLocale('fr', SEO_LOCALES),
    );
    expect(document.querySelector('meta[name="twitter:card"]')?.getAttribute('content')).toBe(
      'summary_large_image',
    );
  });
  it('resolves the base URL from the browser origin, never from process.env', async () => {
    // Regression guard. This page read `process.env['STOREFRONT_PUBLIC_BASE_URL']`
    // at module level, which threw `ReferenceError: process is not defined` on
    // every client render, and no unit test caught it because Vitest runs where
    // `process` exists. Setting the variable and asserting it is IGNORED is what
    // proves the browser branch of the platform guard is actually taken.
    process.env['STOREFRONT_PUBLIC_BASE_URL'] = 'https://server-only.example';
    try {
      await renderAbout('en');
      const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute('content');
      expect(ogUrl).toContain(globalThis.location.origin);
      expect(ogUrl).not.toContain('server-only.example');
    } finally {
      delete process.env['STOREFRONT_PUBLIC_BASE_URL'];
    }
  });

  it('renders the CMS body under the shared rich-text typography class', () => {
    // Component styles cannot reach [innerHTML] children: injected elements
    // never carry the _ngcontent attribute, so the heading scale and the list
    // markers have to come from the global class or from nowhere.
    return renderAbout('en').then((fixture) => {
      const body = (fixture.nativeElement as HTMLElement).querySelector('.body');
      expect(body?.classList.contains('rich-text-content')).toBe(true);
    });
  });
});
