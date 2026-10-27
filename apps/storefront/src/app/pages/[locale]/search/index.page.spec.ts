import { ChangeDetectionStrategy, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchService } from '@storefront-services';

import { LocaleService } from '../../../locale.service';
import { getChromeStrings } from '../../../../i18n';
import { type Locale } from '../../../../i18n/types';
import { regionFromLocale, ogLocaleFromLocale } from '../../../../lib/locale-region';
import SearchResultsPage from './index.page';
import type { SearchLoadPayload } from './index.server';
import {
  fixtureMoney,
  provideFixtureStoreConfig,
  fixtureChromeIdentity,
} from '../../../../test-support/store-config-fixtures';
import { formatMoney } from '../../../../lib/money';
import { fixtureRuntimeConfig } from '../../../../test-support/store-config-fixtures';

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
  readonly currentUrl = () => `/${this._locale()}/search`;
}

/**
 * The `GET /v1/search` hit shape, as the API really sends it.
 *
 * This fixture used to carry `variants: [{ price: '449.00' }]`, a `currency` and
 * a `ratingSummary`, none of which the search serializer has ever emitted. That
 * is what kept the unit tier green while production rendered `0,000 DT` on every
 * card: the mapper's first price branch resolved against a variant that existed
 * only here. Keep it in step with
 * `libs/storefront-types/src/lib/search/__fixtures__/v1-search-lampe.captured.json`,
 * a captured response body, and with `ProductSearchResult` in
 * `apps/api/src/modules/search/search.service.ts`.
 */
const SAMPLE_HITS = [
  {
    product: {
      id: 'p-echo',
      slug: 'echo-buds-pro',
      name: 'Echo Buds Pro',
      brand: 'Echo',
      tags: [],
      isFeatured: false,
      createdAt: '2026-08-25T03:13:24.008Z',
      minPrice: 449,
      avgRating: 4.6,
      reviewCount: 23,
      inStock: true,
      availability: 'IN_STOCK' as const,
      thumbnail: '/uploads/echo-pro-thumb.jpg',
      primaryAsset: { url: '/uploads/echo-pro.jpg' },
      categories: [],
    },
    score: 0.91,
    eventId: 'evt-1',
  },
  {
    product: {
      id: 'p-sonic',
      slug: 'sonic-headphones',
      name: 'Sonic Headphones',
      brand: 'Sonic',
      tags: [],
      isFeatured: false,
      createdAt: '2026-08-25T03:13:24.008Z',
      minPrice: 299,
      avgRating: 4.2,
      reviewCount: 7,
      inStock: true,
      availability: 'IN_STOCK' as const,
      thumbnail: '/uploads/sonic-thumb.jpg',
      primaryAsset: { url: '/uploads/sonic.jpg' },
      categories: [],
    },
    score: 0.85,
    eventId: 'evt-2',
  },
];

const SAMPLE_FACETS = [
  {
    facet: 'brand',
    values: [
      { value: 'Echo', count: 1 },
      { value: 'Sonic', count: 1 },
    ],
  },
];

interface SearchStub {
  search: ReturnType<typeof vi.fn>;
  filters: ReturnType<typeof vi.fn>;
  suggest: ReturnType<typeof vi.fn>;
  logClick: ReturnType<typeof vi.fn>;
  logConversion: ReturnType<typeof vi.fn>;
}

function makeSearchStub(
  opts: {
    hits?: typeof SAMPLE_HITS;
    total?: number;
    facets?: typeof SAMPLE_FACETS;
    searchThrows?: boolean;
  } = {},
): SearchStub {
  return {
    search: vi.fn(async () => {
      if (opts.searchThrows) throw new Error('search down');
      return {
        data: opts.hits ?? SAMPLE_HITS,
        meta: { page: 1, pageSize: 24, total: opts.total ?? (opts.hits ?? SAMPLE_HITS).length },
      };
    }),
    filters: vi.fn(async () => opts.facets ?? SAMPLE_FACETS),
    suggest: vi.fn(async () => []),
    logClick: vi.fn(async () => undefined),
    logConversion: vi.fn(async () => undefined),
  };
}

function buildPayload(
  overrides: Partial<SearchLoadPayload> & { q?: string } = {},
): SearchLoadPayload {
  const trimmed = (overrides.q ?? overrides.query ?? '').trim();
  if (!trimmed) {
    return {
      query: '',
      hits: [],
      totalCount: 0,
      facets: [],
    };
  }
  return {
    query: trimmed,
    hits:
      (overrides.hits as SearchLoadPayload['hits']) ??
      (SAMPLE_HITS as unknown as SearchLoadPayload['hits']),
    totalCount: overrides.totalCount ?? SAMPLE_HITS.length,
    facets:
      (overrides.facets as SearchLoadPayload['facets']) ??
      (SAMPLE_FACETS as unknown as SearchLoadPayload['facets']),
  };
}

async function renderPage(opts: {
  locale: Locale;
  query?: Record<string, string>;
  searchStub?: SearchStub;
  payload?: SearchLoadPayload;
}): Promise<{ fixture: ComponentFixture<SearchResultsPage>; stub: SearchStub; router: Router }> {
  TestBed.overrideComponent(SearchResultsPage, {
    set: { changeDetection: ChangeDetectionStrategy.Default },
  });
  const stub = opts.searchStub ?? makeSearchStub();
  const router = {
    navigate: vi.fn(async () => true),
    navigateByUrl: vi.fn(async () => true),
  } as unknown as Router;
  const queryParam = opts.query?.['q'] ?? '';
  const payload = opts.payload ?? buildPayload({ q: queryParam });
  TestBed.configureTestingModule({
    providers: [
      // The scenario config these specs assert their hreflang and money against.
      provideFixtureStoreConfig('maghreb-ltr'),
      provideRouter([]),
      { provide: LocaleService, useValue: new StubLocaleService(opts.locale) },
      { provide: SearchService, useValue: stub },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap({}),
            queryParamMap: convertToParamMap(opts.query ?? {}),
            data: { load: payload },
          },
          paramMap: of(convertToParamMap({})),
          queryParamMap: of(convertToParamMap(opts.query ?? {})),
          data: of({ load: payload }),
        },
      },
      { provide: Router, useValue: router },
    ],
  });
  const fixture = TestBed.createComponent(SearchResultsPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, stub, router };
}

const AXE_OPTS: axe.RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
  rules: {
    region: { enabled: false },
    'landmark-one-main': { enabled: false },
    'page-has-heading-one': { enabled: false },
  },
};

describe('SearchResultsPage', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  it('renders breadcrumb, h1, sort + filter, and the product grid when results are SSR-seeded', async () => {
    const { fixture } = await renderPage({ locale: 'en', query: { q: 'echo' } });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('app-breadcrumb')).not.toBeNull();
    const h1 = root.querySelector('[data-testid="search-title"]');
    expect(h1?.textContent).toContain('echo');
    expect(root.querySelector('catalog-sort-control')).not.toBeNull();
    expect(root.querySelector('catalog-filter-rail')).not.toBeNull();
    expect(root.querySelector('[data-testid="catalog-grid"]')).not.toBeNull();
  });

  it('renders each hit at the price /v1/search sent, never a literal zero', async () => {
    // The defect this pins: the search serializer sends `minPrice`, the mapper
    // read `variants[0].price` and then `priceMin`, found neither, and floored the
    // card at `0`. Every card on /fr/search?q=lampe rendered `0,000 DT` in
    // production while this suite stayed green, because the fixture above carried
    // a variant the API never sends.
    const { fixture } = await renderPage({ locale: 'en', query: { q: 'echo' } });
    const root = fixture.nativeElement as HTMLElement;

    const cards = root.querySelectorAll('app-product-card');
    expect(cards.length).toBe(SAMPLE_HITS.length);

    const amounts = [...root.querySelectorAll('app-product-card app-price .amount')].map((el) =>
      Number((el.textContent ?? '').replace(/\D/g, '')),
    );
    // Count equality is load-bearing. A card with no resolvable price now renders
    // no price line at all, so a "no zeros" assertion on its own would pass most
    // loudly at the exact moment every price disappeared.
    expect(amounts.length).toBe(cards.length);
    expect(amounts.every((n) => n > 0)).toBe(true);

    const text = root.textContent ?? '';
    for (const hit of SAMPLE_HITS) {
      expect(text).toContain(String(hit.product.minPrice));
    }
  });

  it('renders the rating /v1/search sent on each hit', async () => {
    // Same drift, second casualty: the mapper read `ratingSummary.averageRating`
    // and `.total` while the wire sends `avgRating` and `reviewCount`, so the card
    // saw `reviewCount === undefined` and hid its stars on every search result.
    const { fixture } = await renderPage({ locale: 'en', query: { q: 'echo' } });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('app-product-card app-rating').length).toBe(SAMPLE_HITS.length);
  });

  it('renders no price line at all when a hit carries no price', async () => {
    // The other half of the rule: never substitute a zero for a missing price.
    const priceless = [
      { ...SAMPLE_HITS[0], product: { ...SAMPLE_HITS[0].product, minPrice: null } },
    ] as unknown as typeof SAMPLE_HITS;
    const { fixture } = await renderPage({
      locale: 'en',
      query: { q: 'echo' },
      payload: buildPayload({ q: 'echo', hits: priceless, totalCount: 1 }),
    });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('app-product-card').length).toBe(1);
    expect(root.querySelectorAll('app-product-card app-price').length).toBe(0);
    // Scoped to the grid, not the page. Precision-agnostic too: the zero string
    // is whatever the configured format renders zero as. Both matter. A
    // page-wide substring scan reads a formatted zero inside any larger amount,
    // and the price-filter labels render real amounts now, so "250,000 LD" in
    // the filter rail contains the very string this is looking for.
    const grid = root.querySelector('[data-testid="catalog-grid"]');
    for (const fixtureId of ['maghreb-ltr', 'demo'] as const) {
      expect(grid?.textContent ?? '').not.toContain(formatMoney(0, fixtureMoney(fixtureId)));
    }
  });

  it('does not call searchSvc.search on a fresh load (results are SSR-seeded)', async () => {
    const { stub } = await renderPage({ locale: 'en', query: { q: 'echo' } });
    expect(stub.search).not.toHaveBeenCalled();
    expect(stub.filters).not.toHaveBeenCalled();
  });

  it('renders the bilingual heading + count interpolation', async () => {
    const { fixture } = await renderPage({ locale: 'en', query: { q: 'echo' } });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="search-results-count"]')?.textContent).toContain('2');
  });

  it('shows the no-results empty state when SSR seeds zero hits', async () => {
    const { fixture } = await renderPage({
      locale: 'en',
      query: { q: 'xqxqxqxq' },
      payload: buildPayload({ q: 'xqxqxqxq', hits: [], totalCount: 0 }),
    });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="catalog-grid-empty"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="catalog-grid"]')).toBeNull();
  });

  it('renders the empty-state CTA pointing at the locale home', async () => {
    const { fixture } = await renderPage({
      locale: 'en',
      query: { q: 'xqxqxqxq' },
      payload: buildPayload({ q: 'xqxqxqxq', hits: [], totalCount: 0 }),
    });
    const cta = fixture.nativeElement.querySelector(
      '[data-testid="catalog-grid-empty-cta"]',
    ) as HTMLAnchorElement;
    expect(cta).not.toBeNull();
    expect(cta.textContent?.trim()).toBe(getChromeStrings('en').search.noResults.cta);
  });

  it('forwards a card click into searchService.logClick with the right payload', async () => {
    const { fixture, stub } = await renderPage({ locale: 'en', query: { q: 'echo' } });
    const root = fixture.nativeElement as HTMLElement;
    const cells = root.querySelectorAll('li[data-product-slug]') as NodeListOf<HTMLElement>;
    expect(cells.length).toBe(2);
    cells[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(stub.logClick).toHaveBeenCalledWith('evt-2', {
      clickedProductId: 'p-sonic',
      clickPosition: 1,
    });
  });

  it('navigates in-app on a plain card link click so the page never unloads under the click log', async () => {
    // WebKit drops a fetch still in flight when a link click unloads the page,
    // keepalive or not, so the click log never reached the API on Safari.
    const { fixture, stub, router } = await renderPage({ locale: 'en', query: { q: 'echo' } });
    const link = fixture.nativeElement.querySelector(
      'li[data-product-slug="sonic-headphones"] a[href]',
    ) as HTMLAnchorElement;
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('sonic-headphones');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBe(true);
    expect(stub.logClick).toHaveBeenCalledWith('evt-2', {
      clickedProductId: 'p-sonic',
      clickPosition: 1,
    });
    expect(router.navigateByUrl).toHaveBeenCalledWith(href);
  });

  it.each([
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['middle button', { button: 1 }],
  ])('keeps the browser default on a %s card link click', async (_label, init) => {
    const { fixture, stub, router } = await renderPage({ locale: 'en', query: { q: 'echo' } });
    const link = fixture.nativeElement.querySelector(
      'li[data-product-slug] a[href]',
    ) as HTMLAnchorElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
    link.dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBe(false);
    expect(stub.logClick).toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('does not call logClick when the hit lacks an eventId', async () => {
    const hits = [
      {
        product: { ...SAMPLE_HITS[0].product, id: 'no-event-id' },
        score: 0.4,
        // no eventId
      },
    ] as unknown as typeof SAMPLE_HITS;
    const { fixture, stub } = await renderPage({
      locale: 'en',
      query: { q: 'no' },
      payload: buildPayload({ q: 'no', hits, totalCount: hits.length }),
    });
    const cell = fixture.nativeElement.querySelector('li[data-product-slug]') as HTMLElement;
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(stub.logClick).not.toHaveBeenCalled();
  });

  it('updates URL query params when sort changes', async () => {
    const { fixture, router } = await renderPage({ locale: 'en', query: { q: 'echo' } });
    const sortSelect = fixture.nativeElement.querySelector(
      'catalog-sort-control select',
    ) as HTMLSelectElement;
    sortSelect.value = 'priceAsc';
    sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    expect(router.navigate).toHaveBeenCalled();
    const lastCall = (
      router.navigate as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.pop();
    expect(lastCall).toBeDefined();
    expect((lastCall as unknown[])[1]).toMatchObject({
      queryParams: { sortBy: 'price', sortOrder: 'asc', page: 1 },
      queryParamsHandling: 'merge',
    });
  });

  it('applies title + canonical + hreflang for the active locale', async () => {
    await renderPage({ locale: 'en', query: { q: 'echo' } });
    expect(document.title).toContain('echo');
    const canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    expect(canonical).not.toBeNull();
    expect(canonical.getAttribute('href')).toContain('/en/search?q=echo');
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

  it('falls back to the page heading without query when q is absent (bare /search empty payload)', async () => {
    const { fixture } = await renderPage({ locale: 'en' });
    const h1 = fixture.nativeElement.querySelector('[data-testid="search-title"]');
    expect(h1?.textContent?.trim()).toBe(getChromeStrings('en').search.pageHeading);
  });

  it('passes axe on the rendered page', async () => {
    const { fixture } = await renderPage({ locale: 'en', query: { q: 'echo' } });
    const result = await axe.run(fixture.nativeElement, AXE_OPTS);
    const blocking = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  it('passes axe on the empty state', async () => {
    const { fixture } = await renderPage({
      locale: 'en',
      query: { q: 'xqxqxqxq' },
      payload: buildPayload({ q: 'xqxqxqxq', hits: [], totalCount: 0 }),
    });
    const result = await axe.run(fixture.nativeElement, AXE_OPTS);
    const blocking = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  it('emits og:image, og:url, twitter:card and twitter:image with the share-card fallback', async () => {
    await renderPage({ locale: 'en', query: { q: 'echo' } });
    const ogImage = document.querySelector('meta[property="og:image"]') as HTMLMetaElement;
    expect(ogImage?.getAttribute('content')).toMatch(/\/brand\/default\/og-share-card\.png$/);
    const ogUrl = document.querySelector('meta[property="og:url"]') as HTMLMetaElement;
    expect(ogUrl?.getAttribute('content')).toContain('/en/search?q=echo');
    const twitterCard = document.querySelector('meta[name="twitter:card"]') as HTMLMetaElement;
    expect(twitterCard?.getAttribute('content')).toBe('summary_large_image');
    const twitterImage = document.querySelector('meta[name="twitter:image"]') as HTMLMetaElement;
    expect(twitterImage?.getAttribute('content')).toBe(ogImage?.getAttribute('content'));
  });

  it('emits og:locale and hreflang from the shared locale-region map', async () => {
    // This page builds its own og:locale and its own hreflang triplet rather
    // than going through `lib/seo.ts`, and neither had any assertion, which
    // is how it kept the wrong region tail after the four documented copies
    // were found. Both are derived here, so a future drift in either
    // direction is red.
    await renderPage({ locale: 'fr', query: { q: 'fraises' } });

    const ogLocale = document.querySelector('meta[property="og:locale"]') as HTMLMetaElement;
    expect(ogLocale?.getAttribute('content')).toBe(ogLocaleFromLocale('fr', SEO_LOCALES));

    const hreflangs = Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]')).map(
      (link) => link.getAttribute('hreflang'),
    );
    expect(hreflangs).toEqual([
      ...SEO_LOCALES.supportedLocales.map((l) => regionFromLocale(l, SEO_LOCALES)),
      'x-default',
    ]);
    for (const tag of hreflangs) {
      expect(tag).not.toMatch(/-QA$/);
    }
  });

  it('renders the French heading at /fr/search', async () => {
    const { fixture } = await renderPage({ locale: 'fr', query: { q: 'fraises' } });
    const h1 = fixture.nativeElement.querySelector('[data-testid="search-title"]');
    expect(h1?.textContent).toContain('Résultats pour');
    expect(h1?.textContent).toContain('fraises');
  });

  it('updates pre-existing description + og:title tags instead of duplicating them', async () => {
    // Pre-populate the document head with an old description + og:title.
    const stale = document.createElement('meta');
    stale.setAttribute('name', 'description');
    stale.setAttribute('content', 'STALE-DESCRIPTION');
    document.head.appendChild(stale);
    const staleOg = document.createElement('meta');
    staleOg.setAttribute('property', 'og:title');
    staleOg.setAttribute('content', 'STALE-OG-TITLE');
    document.head.appendChild(staleOg);
    const staleCanonical = document.createElement('link');
    staleCanonical.setAttribute('rel', 'canonical');
    staleCanonical.setAttribute('href', 'https://stale.example/old');
    document.head.appendChild(staleCanonical);

    await renderPage({ locale: 'en', query: { q: 'echo' } });

    const descTags = document.head.querySelectorAll('meta[name="description"]');
    expect(descTags.length).toBe(1);
    expect(descTags[0].getAttribute('content')).not.toContain('STALE');

    const ogTitleTags = document.head.querySelectorAll('meta[property="og:title"]');
    expect(ogTitleTags.length).toBe(1);
    expect(ogTitleTags[0].getAttribute('content')).toContain('echo');

    const canonicalTags = document.head.querySelectorAll('link[rel="canonical"]');
    expect(canonicalTags.length).toBe(1);
    expect(canonicalTags[0].getAttribute('href')).toContain('/en/search?q=echo');
  });
});

/**
 * Finding C1 / C7 (plan L Phase L1).
 *
 * `/search` re-resolves its loader on every query-param change, so sort, brand
 * and price gestures come back through the payload. The page stopped refetching
 * from the pre-navigation snapshot and reads the payload instead.
 */
describe('SearchResultsPage loader-driven refetch', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  async function renderLive(initialQuery: Record<string, string> = { q: 'echo' }): Promise<{
    fixture: ComponentFixture<SearchResultsPage>;
    push: (payload: SearchLoadPayload, query?: Record<string, string>) => Promise<void>;
    stub: SearchStub;
    navigate: ReturnType<typeof vi.fn>;
  }> {
    TestBed.overrideComponent(SearchResultsPage, {
      set: { changeDetection: ChangeDetectionStrategy.Default },
    });
    const stub = makeSearchStub();
    const first = buildPayload({ q: initialQuery['q'] ?? '' });
    const data$ = new BehaviorSubject<{ load: SearchLoadPayload }>({ load: first });
    const snapshot = {
      paramMap: convertToParamMap({}),
      queryParamMap: convertToParamMap(initialQuery),
      data: { load: first },
    };
    const navigate = vi.fn(async () => true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LocaleService, useValue: new StubLocaleService('en') },
        { provide: SearchService, useValue: stub },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot,
            paramMap: of(convertToParamMap({})),
            queryParamMap: of(convertToParamMap(initialQuery)),
            data: data$,
          },
        },
        { provide: Router, useValue: { navigate } },
      ],
    });
    const fixture = TestBed.createComponent(SearchResultsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const push = async (payload: SearchLoadPayload, query?: Record<string, string>) => {
      snapshot.queryParamMap = convertToParamMap(query ?? initialQuery);
      snapshot.data = { load: payload };
      data$.next({ load: payload });
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, push, stub, navigate };
  }

  function gridSlugs(fixture: ComponentFixture<SearchResultsPage>): string[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[data-testid="catalog-grid"] li[data-product-slug]',
      ),
    ).map((li) => li.getAttribute('data-product-slug') ?? '');
  }

  it('re-renders the hits and the count when the loader emits a filtered payload', async () => {
    const { fixture, push } = await renderLive();
    expect(gridSlugs(fixture)).toEqual(['echo-buds-pro', 'sonic-headphones']);

    await push(
      buildPayload({
        q: 'echo',
        hits: [SAMPLE_HITS[0]],
        totalCount: 1,
      }),
      { q: 'echo', brand: 'Echo' },
    );

    expect(gridSlugs(fixture)).toEqual(['echo-buds-pro']);
    const results = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="search-results-count"]',
    );
    expect(results?.textContent?.trim()).toBe('1 result');
  });

  it('does not search itself on a filter change', async () => {
    const { fixture, stub, navigate } = await renderLive();
    const component = fixture.componentInstance as unknown as {
      onFilterChange(c: Record<string, unknown>): void;
    };
    component.onFilterChange({
      brand: 'Echo',
      minPrice: null,
      maxPrice: null,
      priceBand: null,
      specs: [],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(navigate).toHaveBeenCalled();
    expect(stub.search).not.toHaveBeenCalled();
  });

  it('does not search itself on a sort change', async () => {
    const { fixture, stub, navigate } = await renderLive();
    const component = fixture.componentInstance as unknown as {
      onSortChange(c: { key: string; sortBy: string; sortOrder: string }): void;
    };
    component.onSortChange({ key: 'priceAsc', sortBy: 'price', sortOrder: 'asc' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(navigate).toHaveBeenCalled();
    expect(stub.search).not.toHaveBeenCalled();
  });

  it('keeps the searched term in the document title after the loader emits', async () => {
    const { push } = await renderLive();
    await push(buildPayload({ q: 'sonic' }), { q: 'sonic' });
    expect(document.title).toContain('sonic');
  });
});

/**
 * Finding C10, absorbing the prior pass's C2 (plan L Phase L2).
 *
 * A non-2xx from /v1/search was mapped to an empty result set in the loader and
 * in the browser refetch alike, so an outage rendered "No results found" and
 * the shopper was told their query matched nothing. The loaders still soft-fail
 * (a facets outage must not take the page down) but they now carry the failure
 * so the page can say what happened and offer a retry.
 */
describe('SearchResultsPage load failure', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  it('renders the localized error block instead of the empty state', async () => {
    const { fixture } = await renderPage({
      locale: 'en',
      query: { q: 'echo' },
      payload: { ...buildPayload({ q: 'echo', hits: [], totalCount: 0 }), hitsError: true },
    });
    const root = fixture.nativeElement as HTMLElement;
    const error = root.querySelector('[data-testid="search-error"]');
    expect(error).not.toBeNull();
    expect(error?.textContent).toContain(getChromeStrings('en').search.loadError);
    expect(root.querySelector('[data-testid="catalog-grid-empty"]')).toBeNull();
    expect(root.querySelector('[data-testid="search-error-retry"]')).not.toBeNull();
  });

  it('renders the French copy under /fr', async () => {
    const { fixture } = await renderPage({
      locale: 'fr',
      query: { q: 'echo' },
      payload: { ...buildPayload({ q: 'echo', hits: [], totalCount: 0 }), hitsError: true },
    });
    const error = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="search-error"]',
    );
    expect(error?.textContent).toContain(getChromeStrings('fr').search.loadError);
  });

  it('keeps the empty state for a genuinely empty result set', async () => {
    const { fixture } = await renderPage({
      locale: 'en',
      query: { q: 'nothing' },
      payload: buildPayload({ q: 'nothing', hits: [], totalCount: 0 }),
    });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="search-error"]')).toBeNull();
    expect(root.querySelector('[data-testid="catalog-grid-empty"]')).not.toBeNull();
  });

  it('raises the error flag when a retry fails, instead of emptying the hits', async () => {
    const { fixture, stub } = await renderPage({
      locale: 'en',
      query: { q: 'echo' },
      searchStub: makeSearchStub({ searchThrows: true }),
    });
    const component = fixture.componentInstance as unknown as { retry(): void };
    component.retry();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(stub.search).toHaveBeenCalled();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="search-error"]'),
    ).not.toBeNull();
  });

  it('clears the error flag when the retry succeeds', async () => {
    const { fixture } = await renderPage({
      locale: 'en',
      query: { q: 'echo' },
      payload: { ...buildPayload({ q: 'echo', hits: [], totalCount: 0 }), hitsError: true },
    });
    const component = fixture.componentInstance as unknown as { retry(): void };
    component.retry();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="search-error"]')).toBeNull();
    expect(root.querySelector('[data-testid="catalog-grid"]')).not.toBeNull();
  });
});
