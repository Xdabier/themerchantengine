import { ChangeDetectionStrategy, signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocaleService } from '../../../locale.service';
import { type Locale } from '../../../../i18n/types';
import { ogLocaleFromLocale } from '../../../../lib/locale-region';
import CmsPageComponent from './[slug].page';
import type { CmsPageLoadPayload } from './[slug].server';
import { getChromeStrings } from '../../../../i18n';
import {
  fixtureChromeIdentity,
  fixtureRuntimeConfig,
  provideFixtureStoreConfig,
} from '../../../../test-support/store-config-fixtures';

/** The scenario config every page spec renders under. */
const SEO_LOCALES = {
  supportedLocales: fixtureRuntimeConfig('maghreb-ltr').localization.supportedLocales,
  defaultLocale: fixtureRuntimeConfig('maghreb-ltr').localization.defaultLocale,
  country: fixtureRuntimeConfig('maghreb-ltr').identity.address.country,
};

class StubLocaleService {
  private readonly _locale: WritableSignal<Locale>;
  constructor(initial: Locale) {
    this._locale = signal<Locale>(initial);
  }
  readonly locale = () => this._locale();
  readonly chromeIdentity = () => fixtureChromeIdentity('demo', this._locale());
  readonly strings = () => getChromeStrings(this._locale(), this.chromeIdentity());
}

function buildLoadPayload(
  overrides: Partial<CmsPageLoadPayload['page']> = {},
  slug = 'faq',
): CmsPageLoadPayload {
  return {
    slug,
    page: {
      id: 'cms-faq',
      slug: '/faq',
      type: 'STATIC',
      title: 'FAQ',
      content: '<h2>Delivery</h2><p>We ship worldwide.</p><ul><li>Two working days</li></ul>',
      metaTitle: null,
      metaDescription: null,
      ...overrides,
    },
  };
}

async function renderPage(
  locale: Locale,
  payload: CmsPageLoadPayload = buildLoadPayload(),
): Promise<ComponentFixture<CmsPageComponent>> {
  TestBed.overrideComponent(CmsPageComponent, {
    set: { changeDetection: ChangeDetectionStrategy.Default },
  });
  TestBed.configureTestingModule({
    providers: [
      // The scenario config these specs assert their hreflang and money against.
      provideFixtureStoreConfig('maghreb-ltr'),
      provideRouter([]),
      { provide: LocaleService, useValue: new StubLocaleService(locale) },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap({ slug: payload.slug }),
            queryParamMap: convertToParamMap({}),
            data: { load: payload },
          },
          paramMap: of(convertToParamMap({ slug: payload.slug })),
          queryParamMap: of(convertToParamMap({})),
          data: of({ load: payload }),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(CmsPageComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('CmsPage (/{locale}/pages/{slug})', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  it('renders the CMS heading and the sanitized body as real markup', async () => {
    const fixture = await renderPage('en');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#cms-page-heading')?.textContent?.trim()).toBe('FAQ');
    const body = root.querySelector('.body');
    expect(body).not.toBeNull();
    // Not a text assertion: the defect this route replaces rendered tags
    // literally, so the h2 and li must exist as elements.
    expect(body?.querySelector('h2')?.textContent?.trim()).toBe('Delivery');
    expect(body?.querySelectorAll('li').length).toBe(1);
  });

  it('renders the localized title under fr', async () => {
    const fixture = await renderPage(
      'fr',
      buildLoadPayload({ title: 'Questions fréquentes', content: '<p>Nous livrons.</p>' }),
    );
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#cms-page-heading')?.textContent?.trim()).toBe(
      'Questions fréquentes',
    );
  });

  it('renders a <section> and never a second <main> landmark', async () => {
    const fixture = await renderPage('en');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('main')).toBeNull();
    const section = root.querySelector('section');
    expect(section?.getAttribute('aria-labelledby')).toBe('cms-page-heading');
  });

  it('applies the document title and the canonical for the generic route', async () => {
    await renderPage('en');
    expect(document.title).toContain('FAQ');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toContain(
      '/en/pages/faq',
    );
  });

  it('uses the CMS meta fields when present', async () => {
    await renderPage(
      'en',
      buildLoadPayload({
        metaTitle: 'Frequently asked questions',
        metaDescription: 'Answers about delivery, returns and payment.',
      }),
    );
    expect(document.title).toContain('Frequently asked questions');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toContain(
      'Answers about delivery',
    );
  });

  it('falls back to a tag-stripped body excerpt for the meta description', async () => {
    await renderPage('en');
    const desc = document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
    expect(desc).toContain('We ship worldwide');
    expect(desc).not.toContain('<');
  });

  it('emits og:* wired to the locale and the generic path', async () => {
    await renderPage('fr', buildLoadPayload({ title: 'Questions fréquentes' }));
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toContain(
      '/fr/pages/faq',
    );
    expect(document.querySelector('meta[property="og:locale"]')?.getAttribute('content')).toBe(
      ogLocaleFromLocale('fr', SEO_LOCALES),
    );
  });

  it('resolves the base URL from the browser origin, never from process.env', async () => {
    // The two SH5-era CMS pages shipped a bare `process.env` read that threw on
    // every client render. Setting the variable and asserting it is IGNORED is
    // what proves the browser branch of the guard is taken.
    process.env['STOREFRONT_PUBLIC_BASE_URL'] = 'https://server-only.example';
    try {
      await renderPage('en');
      const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute('content');
      expect(ogUrl).toContain(globalThis.location.origin);
      expect(ogUrl).not.toContain('server-only.example');
    } finally {
      delete process.env['STOREFRONT_PUBLIC_BASE_URL'];
    }
  });

  it('passes axe-core WCAG 2.2 AA at the component scope', async () => {
    const fixture = await renderPage('en');
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
});
