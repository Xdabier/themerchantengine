import { ChangeDetectionStrategy, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Category, ProductSummary } from '@storefront-types';
import { STOREFRONT_API_CLIENT, type ApiClient } from '@storefront-services';

import { LocaleService } from '../../locale.service';
import { getChromeStrings } from '../../../i18n';
import { type Locale } from '../../../i18n/types';
import { regionFromLocale } from '../../../lib/locale-region';
import HomePage from './index.page';
import type { HomeLoadPayload } from './index.server';

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

// Product cards mount WishlistService, which injects the API client. Any test
// that renders a populated rail needs the token bound.
const noopApi = { get: async () => ({}), post: async () => ({}) } as unknown as ApiClient;

class StubLocaleService {
  private readonly _locale: WritableSignal<Locale>;

  constructor(initial: Locale) {
    this._locale = signal<Locale>(initial);
  }

  readonly locale = () => this._locale();
  readonly chromeIdentity = () => fixtureChromeIdentity('demo', this._locale());
  readonly strings = () => getChromeStrings(this._locale(), this.chromeIdentity());
  readonly currentUrl = () => `/${this._locale()}/`;
}

/**
 * Build the SH3 page-server-endpoint payload that `injectLoad<typeof load>()`
 * resolves to in production. The component reads `loaded` synchronously via
 * `toSignal(injectLoad<typeof load>(), { requireSync: true })`, which
 * subscribes to `ActivatedRoute.data` and projects `data['load']`.
 *
 * Ships one row per surviving `SectionType` so the dynamic-dispatch path
 * mounts every testid-bearing component the spec assertions look for. Each
 * row's `config` follows the per-type Zod schema's required keys.
 */
function buildLoadPayload(): HomeLoadPayload {
  const sections = [
    {
      id: 'sec-hero',
      pageSlug: 'home',
      type: 'HERO' as const,
      title: { default: 'Welcome', en: 'Welcome', fr: 'Bienvenue' },
      sortOrder: 0,
      isVisible: true,
      visibleFrom: null,
      visibleUntil: null,
      config: {
        assetId: '00000000-0000-0000-0000-000000000001',
        eyebrow: { default: 'Launch', en: 'Launch', fr: 'Lancement' },
        headline: { default: 'Trusted', en: 'Trusted', fr: 'Fiable' },
        body: { default: 'Body', en: 'Body', fr: 'Texte' },
        cta: { default: 'Shop', en: 'Shop', fr: 'Acheter' },
        ctaHref: '/catalog',
      },
    },
    {
      id: 'sec-categories',
      pageSlug: 'home',
      type: 'CATEGORY_SHOWCASE' as const,
      title: { default: 'Categories', en: 'Categories', fr: 'Catégories' },
      sortOrder: 1,
      isVisible: true,
      visibleFrom: null,
      visibleUntil: null,
      config: {
        categoryIds: ['00000000-0000-0000-0000-000000000010'],
        heading: { default: 'Browse', en: 'Browse', fr: 'Parcourir' },
      },
    },
    {
      id: 'sec-trust',
      pageSlug: 'home',
      type: 'TRUST_SIGNALS' as const,
      title: { default: 'Trust', en: 'Trust', fr: 'Confiance' },
      sortOrder: 2,
      isVisible: true,
      visibleFrom: null,
      visibleUntil: null,
      config: {
        items: [
          {
            kind: 'delivery' as const,
            title: { default: 'Fast', en: 'Fast', fr: 'Rapide' },
            subtitle: { default: 'Today', en: 'Today', fr: 'Aujourd’hui' },
          },
        ],
      },
    },
    {
      id: 'sec-featured',
      pageSlug: 'home',
      type: 'FEATURED_PRODUCTS' as const,
      title: { default: 'Picks', en: 'Picks', fr: 'Sélection' },
      sortOrder: 3,
      isVisible: true,
      visibleFrom: null,
      visibleUntil: null,
      config: {
        productIds: ['00000000-0000-0000-0000-0000000000f1'],
        variant: 'grid' as const,
      },
    },
    {
      id: 'sec-promo',
      pageSlug: 'home',
      type: 'PROMOTIONAL_BANNER' as const,
      title: { default: 'Promo', en: 'Promo', fr: 'Promo' },
      sortOrder: 4,
      isVisible: true,
      visibleFrom: null,
      visibleUntil: null,
      config: {
        assetId: '00000000-0000-0000-0000-000000000002',
        eyebrow: { default: 'Family', en: 'Family', fr: 'Famille' },
        headline: { default: 'Sets', en: 'Sets', fr: 'Coffrets' },
        body: { default: 'Body', en: 'Body', fr: 'Texte' },
        cta: { default: 'Discover', en: 'Discover', fr: 'Découvrir' },
      },
    },
  ];
  return {
    categories: [],
    featured: [],
    sections: sections as unknown as HomeLoadPayload['sections'],
  };
}

/**
 * Pool + category fixtures for the B2 substitution guards. The guard only
 * means anything when the pools are NON-empty: with empty pools the fallback
 * branch and the honest empty state render the same thing, so the test could
 * never fail on the defect it exists to catch.
 */
function poolProduct(id: string, slug: string): ProductSummary {
  return {
    id,
    slug,
    name: { default: slug, en: slug, fr: slug },
    primaryAsset: null,
    variants: [{ id: `var-${id}`, price: '10.00', stock: 5 }],
    currency: 'LYD',
  } as unknown as ProductSummary;
}

function poolCategory(id: string, slug: string): Category {
  return {
    id,
    slug,
    name: { default: slug, en: slug, fr: slug },
    parentId: null,
    children: [],
  } as unknown as Category;
}

async function renderHome(
  locale: Locale,
  payload: HomeLoadPayload = buildLoadPayload(),
): Promise<ComponentFixture<HomePage>> {
  const stub = new StubLocaleService(locale);
  TestBed.overrideComponent(HomePage, {
    set: { changeDetection: ChangeDetectionStrategy.Default },
  });
  TestBed.configureTestingModule({
    providers: [
      // The scenario config these specs assert their hreflang and money against.
      provideFixtureStoreConfig('maghreb-ltr'),
      provideRouter([]),
      { provide: LocaleService, useValue: stub },
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
  const fixture = TestBed.createComponent(HomePage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const HOME_AXE_OPTS: axe.RunOptions = {
  runOnly: {
    type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'],
  },
  rules: {
    region: { enabled: false },
    'landmark-one-main': { enabled: false },
    'page-has-heading-one': { enabled: false },
  },
};

describe('HomePage', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  it('renders one block per configured section on /fr/', async () => {
    const fixture = await renderHome('fr');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="home-hero"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="home-categories"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="home-trust-strip"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="home-featured-sec-featured"]')).not.toBeNull();
  });

  it('renders nothing at all when no section is configured', async () => {
    // S1: the two thematic rails used to render unconditionally, so removing
    // every section in the admin still left a populated home page.
    const payload = buildLoadPayload();
    payload.sections = [];
    payload.categories = [poolCategory('00000000-0000-0000-0000-0000000000c1', 'unrelated-one')];
    payload.featured = [poolProduct('pool-1', 'pool-one')];

    const fixture = await renderHome('fr', payload);
    const root = fixture.nativeElement as HTMLElement;

    // Count section blocks, not any `home-*` testid: category tiles carry
    // `home-category-<slug>` and would inflate a prefix match.
    expect(root.querySelectorAll('.page > *')).toHaveLength(0);
  });

  it('does not append an extra rail per CATEGORY_SHOWCASE or TRUST_SIGNALS row', async () => {
    // S1 / D8: a just-arrived rail was emitted after every CATEGORY_SHOWCASE
    // and a selection rail after every TRUST_SIGNALS, so two rows of one type
    // silently produced four blocks.
    const payload = buildLoadPayload();
    const showcase = payload.sections.find((s) => s.type === 'CATEGORY_SHOWCASE')!;
    payload.sections = [
      showcase,
      { ...showcase, id: 'sec-categories-2' },
    ] as HomeLoadPayload['sections'];
    payload.categories = [poolCategory('00000000-0000-0000-0000-000000000010', 'configured-one')];

    const fixture = await renderHome('fr', payload);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelectorAll('[data-testid="home-categories"]')).toHaveLength(2);
    expect(root.querySelectorAll('.page > *')).toHaveLength(2);
  });

  it('dispatches a PROMOTIONAL_BANNER row instead of dropping it (H2)', async () => {
    // Before B8 the type was filtered out before dispatch, so an operator could
    // configure a banner in the admin, get a 201, and never see it render or
    // learn why. This asserts the positive form: the row survives to the
    // outlet and its headline reaches the page.
    const payload = buildLoadPayload();
    const promoted = payload.sections.filter((s) => s.type === 'PROMOTIONAL_BANNER');
    expect(promoted.length).toBeGreaterThan(0);

    const fixture = await renderHome('fr', payload);
    const rendered = (
      fixture.componentInstance as unknown as { sections: () => Array<{ type: string }> }
    ).sections();
    expect(rendered).toHaveLength(payload.sections.length);
    expect(rendered.some((s) => s.type === 'PROMOTIONAL_BANNER')).toBe(true);

    const root = fixture.nativeElement as HTMLElement;
    const banner = root.querySelector('[data-testid="home-promo-banner"]');
    expect(banner).not.toBeNull();
    expect(banner!.querySelector('.headline')?.textContent?.trim()).toBe('Coffrets');
  });

  it('gives the flat primary band to the first banner only', async () => {
    // A large flat primary fill is reserved for one banner per page, and
    // brand-auditor fails a second. Two configured rows must not be able to put
    // the page into a violation on their own.
    const payload = buildLoadPayload();
    const promo = payload.sections.find((s) => s.type === 'PROMOTIONAL_BANNER')!;
    payload.sections = [promo, { ...promo, id: 'sec-promo-2' }] as HomeLoadPayload['sections'];

    const fixture = await renderHome('fr', payload);
    const banners = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="home-promo-banner"]'),
    );
    expect(banners).toHaveLength(2);
    expect(banners[0]!.classList.contains('banner--band')).toBe(true);
    expect(banners[1]!.classList.contains('banner--band')).toBe(false);
  });

  it('renders the empty state for a curated featured rail whose ids do not resolve', async () => {
    // S3: a dead productId used to fall through to the just-arrived / popular
    // pool, so config rot rendered as a full rail of unrelated products and the
    // operator never saw it. `featured()` is deliberately NON-empty and holds a
    // product the section does not reference, so an implementation that renders
    // whatever the loader returned still fails this.
    const payload = buildLoadPayload();
    payload.featured = [poolProduct('pool-1', 'pool-one')];

    const fixture = await renderHome('fr', payload);
    const root = fixture.nativeElement as HTMLElement;

    const rail = root.querySelector('[data-testid="home-featured-sec-featured"]');
    expect(rail, 'the configured featured section still renders its frame').not.toBeNull();
    expect(
      root.querySelector('[data-testid="home-featured-sec-featured-empty"]'),
      'a curated rail that resolves to nothing shows its own empty state',
    ).not.toBeNull();
    expect(rail!.querySelectorAll('app-product-card')).toHaveLength(0);
  });

  it('renders the empty state for a category showcase whose ids do not resolve', async () => {
    // S3, second site: a dead categoryId used to fall back to ALL categories.
    const payload = buildLoadPayload();
    payload.categories = [
      poolCategory('00000000-0000-0000-0000-0000000000c1', 'unrelated-one'),
      poolCategory('00000000-0000-0000-0000-0000000000c2', 'unrelated-two'),
    ];

    const fixture = await renderHome('fr', payload);
    const root = fixture.nativeElement as HTMLElement;

    expect(
      root.querySelector('[data-testid="home-categories-empty"]'),
      'a showcase that resolves to nothing shows its own empty state',
    ).not.toBeNull();
    expect(root.querySelectorAll('[data-testid^="home-category-"]')).toHaveLength(0);
  });

  it('titles a featured rail from config.heading, with the envelope title as fallback', async () => {
    // S1c: the rail titled itself from `section.title` only, so a merchant who
    // filled the config heading got the envelope title, or nothing at all when
    // the envelope title was empty. CATEGORY_SHOWCASE already preferred
    // `cfg.heading`; the two types disagreed.
    const payload = buildLoadPayload();
    const featured = payload.sections.find((s) => s.type === 'FEATURED_PRODUCTS')!;
    (featured as { config: Record<string, unknown> }).config = {
      ...(featured as { config: Record<string, unknown> }).config,
      heading: { default: 'Config heading', en: 'Config heading', fr: 'Titre de config' },
      eyebrow: { default: 'Config eyebrow', en: 'Config eyebrow', fr: 'Surtitre de config' },
    };

    const fixture = await renderHome('en', payload);
    const rail = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="home-featured-sec-featured"]',
    )!;
    expect(rail.querySelector('.title')?.textContent?.trim()).toBe('Config heading');
    expect(rail.querySelector('.eyebrow')?.textContent?.trim()).toBe('Config eyebrow');
  });

  it('falls back to the envelope title when a featured rail has no config heading', async () => {
    const fixture = await renderHome('en');
    const rail = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="home-featured-sec-featured"]',
    )!;
    // The fixture's envelope title is 'Picks' and its config has no heading.
    expect(rail.querySelector('.title')?.textContent?.trim()).toBe('Picks');
    expect(rail.querySelector('.eyebrow')).toBeNull();
  });

  it('renders the hero CTA pointing at the locale-prefixed catalog route on /en/', async () => {
    const fixture = await renderHome('en');
    const cta = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="home-hero-cta"]',
    );
    expect(cta).not.toBeNull();
    expect(cta?.getAttribute('href')).toBe('/en/catalog');
  });

  it('emits Organization + WebSite + BreadcrumbList JSON-LD into the document head', async () => {
    await renderHome('fr');
    const scripts = document.head.querySelectorAll(
      'script[type="application/ld+json"][data-home-jsonld]',
    );
    expect(scripts.length).toBe(3);
    const types = Array.from(scripts).map((s) => JSON.parse(s.textContent ?? '{}')['@type']);
    expect(types).toEqual(['Organization', 'WebSite', 'BreadcrumbList']);
  });

  it('applies the title and meta description for the active locale', async () => {
    await renderHome('fr');
    expect(document.title).toContain(fixtureChromeIdentity('demo', 'fr').storeName);
    const desc = document.querySelector('meta[name="description"]');
    expect(desc?.getAttribute('content')?.length ?? 0).toBeGreaterThan(20);
  });

  it('names the store once in the tab title, not twice', async () => {
    // The home `meta.title` used to be "<brand> · <tagline>", and `pageTitle`
    // only looked at the END of the string for the suffix, so /en shipped the
    // name twice. `toContain` above cannot see that, which is why it survived
    // a close-out pass.
    await renderHome('en');
    const store = fixtureChromeIdentity('demo', 'en').storeName;
    expect(document.title.split(store).length - 1).toBe(1);
  });

  it('emits canonical + hreflang triplet on the document head', async () => {
    await renderHome('fr');
    const canonical = document.querySelector('link[rel="canonical"]');
    expect(canonical).not.toBeNull();
    const hreflangs = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="alternate"][hreflang]'),
    ).map((l) => l.getAttribute('hreflang'));
    expect(hreflangs.sort()).toEqual(
      [
        ...SEO_LOCALES.supportedLocales.map((l) => regionFromLocale(l, SEO_LOCALES)),
        'x-default',
      ].sort(),
    );
  });

  it('passes axe-core WCAG 2.2 AA on /fr/', async () => {
    const fixture = await renderHome('fr');
    const result = await axe.run(fixture.nativeElement, HOME_AXE_OPTS);
    const blocking = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  it('passes axe-core WCAG 2.2 AA on /en/', async () => {
    const fixture = await renderHome('en');
    const result = await axe.run(fixture.nativeElement, HOME_AXE_OPTS);
    const blocking = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});
