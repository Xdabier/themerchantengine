import { ChangeDetectionStrategy, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CategoriesService,
  ProductsService,
  STOREFRONT_API_CLIENT,
  type ApiClient,
} from '@storefront-services';

import { LocaleService } from '../../../locale.service';
import { getChromeStrings } from '../../../../i18n';
import { type Locale } from '../../../../i18n/types';
import { regionFromLocale } from '../../../../lib/locale-region';
import CatalogCategoryPage from './[slug].page';
import type { CatalogCategoryLoadPayload } from './[slug].server';

import {
  fixtureRuntimeConfig,
  provideFixtureStoreConfig,
  fixtureChromeIdentity,
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
  readonly currentUrl = () => `/${this._locale()}/catalog/fx-audio`;
}

const SAMPLE_CATEGORY = {
  id: 'cat-audio',
  slug: 'fx-audio',
  name: 'Audio',
  description: 'Headphones and earbuds.',
  productCount: 12,
};

const SAMPLE_PRODUCTS = [
  {
    id: 'p1',
    slug: 'echo-buds-pro',
    name: 'Echo Buds Pro',
    description: 'Wireless earbuds.',
    brand: 'Echo',
    primaryAsset: { url: '/uploads/echo-pro.jpg' },
    variants: [{ id: 'v1', price: '449.00', stock: 10 }],
    currency: 'AED',
  },
  {
    id: 'p2',
    slug: 'sonic-headphones',
    name: 'Sonic Headphones',
    description: 'Over-ear headphones.',
    brand: 'Sonic',
    primaryAsset: { url: '/uploads/sonic.jpg' },
    variants: [{ id: 'v2', price: '299.00', stock: 5 }],
    currency: 'AED',
  },
];

function buildPayload(
  overrides: Partial<CatalogCategoryLoadPayload> = {},
): CatalogCategoryLoadPayload {
  return {
    category:
      (overrides.category as CatalogCategoryLoadPayload['category']) ??
      (SAMPLE_CATEGORY as unknown as CatalogCategoryLoadPayload['category']),
    products:
      (overrides.products as CatalogCategoryLoadPayload['products']) ??
      (SAMPLE_PRODUCTS as unknown as CatalogCategoryLoadPayload['products']),
    totalCount: overrides.totalCount ?? SAMPLE_PRODUCTS.length,
  };
}

function makeProductsServiceStub() {
  return {
    list: vi.fn(async () => ({
      data: SAMPLE_PRODUCTS,
      meta: { page: 1, pageSize: 24, total: 2 },
    })),
    getBySlug: vi.fn(),
  };
}

function makeCategoriesServiceStub(throws = false) {
  return {
    list: vi.fn(async () => [SAMPLE_CATEGORY]),
    getBySlug: vi.fn(async () => {
      if (throws) throw new Error('not found');
      return SAMPLE_CATEGORY;
    }),
    listProducts: vi.fn(),
  };
}

async function renderPage(opts: {
  locale: Locale;
  query?: Record<string, string>;
  payload?: CatalogCategoryLoadPayload;
}): Promise<ComponentFixture<CatalogCategoryPage>> {
  TestBed.overrideComponent(CatalogCategoryPage, {
    set: { changeDetection: ChangeDetectionStrategy.Default },
  });
  const noopApi: ApiClient = {
    get: async () => ({}) as never,
    post: async () => ({}) as never,
    patch: async () => ({}) as never,
    delete: async () => ({}) as never,
    request: async () => ({}) as never,
  };
  const payload = opts.payload ?? buildPayload();
  TestBed.configureTestingModule({
    providers: [
      // The scenario config these specs assert their hreflang and money against.
      provideFixtureStoreConfig('maghreb-ltr'),
      provideRouter([]),
      { provide: LocaleService, useValue: new StubLocaleService(opts.locale) },
      { provide: ProductsService, useValue: makeProductsServiceStub() },
      { provide: CategoriesService, useValue: makeCategoriesServiceStub(false) },
      { provide: STOREFRONT_API_CLIENT, useValue: noopApi },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap({ slug: payload.category.slug }),
            queryParamMap: convertToParamMap(opts.query ?? {}),
            data: { load: payload },
          },
          paramMap: of(convertToParamMap({ slug: payload.category.slug })),
          queryParamMap: of(convertToParamMap(opts.query ?? {})),
          data: of({ load: payload }),
        },
      },
      { provide: Router, useValue: { navigate: vi.fn(async () => true) } },
    ],
  });
  const fixture = TestBed.createComponent(CatalogCategoryPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const AXE_OPTS: axe.RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
  rules: {
    region: { enabled: false },
    'landmark-one-main': { enabled: false },
    'page-has-heading-one': { enabled: false },
  },
};

describe('CatalogCategoryPage', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  it('renders breadcrumb, h1, sort, filter rail, and the product grid from the SSR-seeded payload', async () => {
    const fixture = await renderPage({ locale: 'en' });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('app-breadcrumb')).not.toBeNull();
    expect(root.querySelector('h1.title')?.textContent).toContain('Audio');
    expect(root.querySelector('catalog-sort-control')).not.toBeNull();
    expect(root.querySelector('catalog-filter-rail')).not.toBeNull();
    expect(root.querySelector('[data-testid="catalog-grid"]')).not.toBeNull();
  });

  it('does not call categoriesSvc.getBySlug or productsSvc.list on a fresh load (both are SSR-seeded)', async () => {
    await renderPage({ locale: 'en' });
    const productsSvc = TestBed.inject(ProductsService) as unknown as {
      list: ReturnType<typeof vi.fn>;
    };
    const categoriesSvc = TestBed.inject(CategoriesService) as unknown as {
      getBySlug: ReturnType<typeof vi.fn>;
    };
    expect(productsSvc.list).not.toHaveBeenCalled();
    expect(categoriesSvc.getBySlug).not.toHaveBeenCalled();
  });

  it('emits BreadcrumbList + ItemList JSON-LD into the head when products load', async () => {
    await renderPage({ locale: 'en' });
    const scripts = document.head.querySelectorAll(
      'script[type="application/ld+json"][data-catalog-jsonld]',
    );
    expect(scripts.length).toBeGreaterThanOrEqual(2);
    const types = Array.from(scripts).map((s) => JSON.parse(s.textContent ?? '{}')['@type']);
    expect(types).toContain('BreadcrumbList');
    expect(types).toContain('ItemList');
  });

  it('applies title + canonical + hreflang for the active locale', async () => {
    await renderPage({ locale: 'en' });
    expect(document.title.length).toBeGreaterThan(0);
    expect(document.title).toContain('Audio');
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

  it('reads sort + filter from query params on init', async () => {
    const fixture = await renderPage({
      locale: 'en',
      query: {
        sortBy: 'price',
        sortOrder: 'asc',
        brand: 'Echo',
        minPrice: '100',
        maxPrice: '500',
      },
    });
    const root = fixture.nativeElement as HTMLElement;
    const sortSelect = root.querySelector('catalog-sort-control select') as HTMLSelectElement;
    expect(sortSelect.value).toBe('priceAsc');
  });

  it('passes axe on the rendered page', async () => {
    const fixture = await renderPage({ locale: 'en' });
    const result = await axe.run(fixture.nativeElement, AXE_OPTS);
    const blocking = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  describe('infinite-scroll pagination', () => {
    function buildPage(page: number): Array<Record<string, unknown>> {
      return Array.from({ length: 24 }, (_, i) => ({
        id: `p${page}-${i}`,
        slug: `slug-${page}-${i}`,
        name: { en: `Product ${page}-${i}`, fr: `Product ${page}-${i}` },
        description: 'Item.',
        brand: 'BrandX',
        primaryAsset: { url: '/uploads/x.jpg' },
        variants: [{ id: `v${page}-${i}`, price: '100.00', stock: 5 }],
        currency: 'AED',
      }));
    }

    async function renderWithMultiPage(opts: {
      total: number;
      query?: Record<string, string>;
    }): Promise<{
      fixture: ComponentFixture<CatalogCategoryPage>;
      list: ReturnType<typeof vi.fn>;
    }> {
      TestBed.overrideComponent(CatalogCategoryPage, {
        set: { changeDetection: ChangeDetectionStrategy.Default },
      });
      const list = vi.fn(async (q: { page?: number; pageSize?: number }) => ({
        data: buildPage(q.page ?? 1),
        meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 24, total: opts.total },
      }));
      const noopApi: ApiClient = {
        get: async () => ({}) as never,
        post: async () => ({}) as never,
        patch: async () => ({}) as never,
        delete: async () => ({}) as never,
        request: async () => ({}) as never,
      };
      // Seed page 1 of products + the resolved category — mirrors the SSR
      // payload contract.
      const payload: CatalogCategoryLoadPayload = {
        category: SAMPLE_CATEGORY as unknown as CatalogCategoryLoadPayload['category'],
        products: buildPage(1) as unknown as CatalogCategoryLoadPayload['products'],
        totalCount: opts.total,
      };
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          { provide: LocaleService, useValue: new StubLocaleService('en') },
          { provide: ProductsService, useValue: { list, getBySlug: vi.fn() } },
          { provide: CategoriesService, useValue: makeCategoriesServiceStub(false) },
          { provide: STOREFRONT_API_CLIENT, useValue: noopApi },
          {
            provide: ActivatedRoute,
            useValue: {
              snapshot: {
                paramMap: convertToParamMap({ slug: 'fx-audio' }),
                queryParamMap: convertToParamMap(opts.query ?? {}),
                data: { load: payload },
              },
              paramMap: of(convertToParamMap({ slug: 'fx-audio' })),
              queryParamMap: of(convertToParamMap(opts.query ?? {})),
              data: of({ load: payload }),
            },
          },
          { provide: Router, useValue: { navigate: vi.fn(async () => true) } },
        ],
      });
      const fixture = TestBed.createComponent(CatalogCategoryPage);
      fixture.detectChanges();
      // Drain enough microtask cycles for the longest restoreFromPage2 chain.
      for (let i = 0; i < 16; i += 1) {
        fixture.detectChanges();
        await fixture.whenStable();
      }
      fixture.detectChanges();
      return { fixture, list };
    }

    it('appends page 2 cards when the load-more sentinel button is clicked', async () => {
      const { fixture, list } = await renderWithMultiPage({ total: 72 });
      let cards = fixture.nativeElement.querySelectorAll(
        '[data-testid="catalog-grid"] li[data-product-slug]',
      );
      expect(cards.length).toBe(24);
      const button = fixture.nativeElement.querySelector(
        '[data-testid="catalog-load-more-button"]',
      ) as HTMLButtonElement;
      expect(button).not.toBeNull();
      button.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      cards = fixture.nativeElement.querySelectorAll(
        '[data-testid="catalog-grid"] li[data-product-slug]',
      );
      expect(cards.length).toBe(48);
      const lastCallPage = list.mock.calls[list.mock.calls.length - 1]?.[0]?.page;
      expect(lastCallPage).toBe(2);
    });

    it('caps JSON-LD ItemList at PAGE_SIZE (24) entries even after a page-2 append', async () => {
      const { fixture } = await renderWithMultiPage({ total: 72 });
      const button = fixture.nativeElement.querySelector(
        '[data-testid="catalog-load-more-button"]',
      ) as HTMLButtonElement;
      button.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const cards = fixture.nativeElement.querySelectorAll(
        '[data-testid="catalog-grid"] li[data-product-slug]',
      );
      expect(cards.length).toBe(48);
      const itemListScripts = Array.from(
        document.head.querySelectorAll<HTMLScriptElement>(
          'script[type="application/ld+json"][data-catalog-jsonld]',
        ),
      )
        .map((s) => JSON.parse(s.textContent ?? '{}'))
        .filter((p) => p['@type'] === 'ItemList');
      expect(itemListScripts.length).toBeGreaterThan(0);
      const itemListElement = itemListScripts[itemListScripts.length - 1].itemListElement;
      expect(Array.isArray(itemListElement)).toBe(true);
      expect(itemListElement.length).toBe(24);
    });

    it('restore-from-deep-link issues sequential fetches up to ?page=N starting at page 2', async () => {
      const { fixture, list } = await renderWithMultiPage({
        total: 72,
        query: { page: '3' },
      });
      const cards = fixture.nativeElement.querySelectorAll(
        '[data-testid="catalog-grid"] li[data-product-slug]',
      );
      expect(cards.length).toBe(72);
      const productPages = list.mock.calls
        .map((c) => c[0]?.page)
        .filter((p): p is number => typeof p === 'number');
      expect(productPages).toEqual([2, 3]);
    });

    it('caps deep-link restoration at MAX_RESTORE_PAGES (10), starting from page 2', async () => {
      const { fixture, list } = await renderWithMultiPage({
        total: 24 * 15,
        query: { page: '15' },
      });
      const cards = fixture.nativeElement.querySelectorAll(
        '[data-testid="catalog-grid"] li[data-product-slug]',
      );
      expect(cards.length).toBe(24 * 10);
      const productPages = list.mock.calls
        .map((c) => c[0]?.page)
        .filter((p): p is number => typeof p === 'number');
      expect(productPages).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
  });
});

/**
 * Finding C7 behaviour half (plan K Phase K4). The category page carried the
 * same gap as the catalog page: the select showed "Newest" while no sort was
 * sent, so the API ordered by `sortOrder asc` over rows that are all 0.
 */
describe('CatalogCategoryPage default sort', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  async function lastQueryAfterAppend(
    query?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const fixture = await renderPage({
      locale: 'en',
      query,
      payload: buildPayload({ totalCount: 100 }),
    });
    const productsSvc = TestBed.inject(ProductsService) as unknown as {
      list: ReturnType<typeof vi.fn>;
    };
    // Sort and filter gestures navigate and let the loader answer, so the
    // append is the browser-side fetch that goes through the query builder.
    const component = fixture.componentInstance as unknown as { onLoadMore(): void };
    component.onLoadMore();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(productsSvc.list).toHaveBeenCalled();
    const calls = productsSvc.list.mock.calls;
    return calls[calls.length - 1]?.[0] as Record<string, unknown>;
  }

  it('asks for the newest products when the URL carries no sort', async () => {
    expect(await lastQueryAfterAppend()).toMatchObject({
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
  });

  it('lets an explicit URL sort win', async () => {
    expect(await lastQueryAfterAppend({ sortBy: 'price', sortOrder: 'desc' })).toMatchObject({
      sortBy: 'price',
      sortOrder: 'desc',
    });
  });

  it('falls back to newest when the URL sort is not one the control offers', async () => {
    expect(await lastQueryAfterAppend({ sortBy: 'bogus', sortOrder: 'sideways' })).toMatchObject({
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
  });
});

/**
 * Finding C1 / C7 (plan L Phase L1).
 *
 * The category route re-resolves its loader on a query-param change and on a
 * sibling-slug change alike, so the payload always describes the URL the
 * customer is on. The page reads that payload instead of refetching from a
 * pre-navigation snapshot.
 */
describe('CatalogCategoryPage loader-driven refetch', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  async function renderLive(initialQuery: Record<string, string> = {}): Promise<{
    fixture: ComponentFixture<CatalogCategoryPage>;
    push: (payload: CatalogCategoryLoadPayload, query?: Record<string, string>) => Promise<void>;
    list: ReturnType<typeof vi.fn>;
    getBySlug: ReturnType<typeof vi.fn>;
    navigate: ReturnType<typeof vi.fn>;
  }> {
    TestBed.overrideComponent(CatalogCategoryPage, {
      set: { changeDetection: ChangeDetectionStrategy.Default },
    });
    const noopApi: ApiClient = {
      get: async () => ({}) as never,
      post: async () => ({}) as never,
      patch: async () => ({}) as never,
      delete: async () => ({}) as never,
      request: async () => ({}) as never,
    };
    const first = buildPayload();
    const data$ = new BehaviorSubject<{ load: CatalogCategoryLoadPayload }>({ load: first });
    const snapshot = {
      paramMap: convertToParamMap({ slug: first.category.slug }),
      queryParamMap: convertToParamMap(initialQuery),
      data: { load: first },
    };
    const paramMap$ = new BehaviorSubject(convertToParamMap({ slug: first.category.slug }));
    const productsSvc = makeProductsServiceStub();
    const categoriesSvc = makeCategoriesServiceStub(false);
    const navigate = vi.fn(async () => true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LocaleService, useValue: new StubLocaleService('en') },
        { provide: ProductsService, useValue: productsSvc },
        { provide: CategoriesService, useValue: categoriesSvc },
        { provide: STOREFRONT_API_CLIENT, useValue: noopApi },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot,
            paramMap: paramMap$,
            queryParamMap: of(convertToParamMap(initialQuery)),
            data: data$,
          },
        },
        { provide: Router, useValue: { navigate } },
      ],
    });
    const fixture = TestBed.createComponent(CatalogCategoryPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const push = async (payload: CatalogCategoryLoadPayload, query?: Record<string, string>) => {
      snapshot.paramMap = convertToParamMap({ slug: payload.category.slug });
      snapshot.queryParamMap = convertToParamMap(query ?? initialQuery);
      snapshot.data = { load: payload };
      paramMap$.next(convertToParamMap({ slug: payload.category.slug }));
      data$.next({ load: payload });
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, push, list: productsSvc.list, getBySlug: categoriesSvc.getBySlug, navigate };
  }

  function gridSlugs(fixture: ComponentFixture<CatalogCategoryPage>): string[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[data-testid="catalog-grid"] li[data-product-slug]',
      ),
    ).map((li) => li.getAttribute('data-product-slug') ?? '');
  }

  it('re-renders the grid and the count when the loader emits a filtered payload', async () => {
    const { fixture, push } = await renderLive();
    expect(gridSlugs(fixture)).toEqual(['echo-buds-pro', 'sonic-headphones']);

    await push(
      buildPayload({
        products: [SAMPLE_PRODUCTS[1]] as unknown as CatalogCategoryLoadPayload['products'],
        totalCount: 1,
      }),
      { brand: 'Sonic' },
    );

    expect(gridSlugs(fixture)).toEqual(['sonic-headphones']);
    const results = (fixture.nativeElement as HTMLElement).querySelector('.results');
    expect(results?.textContent?.trim()).toContain('1');
  });

  it('renders the category header image when the API resolved one', async () => {
    // S5 / H4 / D6, third surface: the category page header was title + count
    // only, so an uploaded image had nowhere to appear here either.
    const fixture = await renderPage({
      locale: 'en',
      payload: buildPayload({
        category: {
          ...SAMPLE_CATEGORY,
          imageUrl: 'https://cdn/cat-400.webp',
          imageVariants: [
            { url: 'https://cdn/cat-400.webp', width: 400, format: 'webp' },
            { url: 'https://cdn/cat-400.avif', width: 400, format: 'avif' },
          ],
        } as unknown as CatalogCategoryLoadPayload['category'],
      }),
    });
    const header = (fixture.nativeElement as HTMLElement).querySelector('.header')!;
    const img = header.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://cdn/cat-400.webp');
    // Decorative: the h1 already names the page.
    expect(img?.getAttribute('alt')).toBe('');
    expect(header.querySelector('h1.title')?.textContent).toContain('Audio');
  });

  it('renders no header media for a category with no image', async () => {
    const fixture = await renderPage({ locale: 'en' });
    const header = (fixture.nativeElement as HTMLElement).querySelector('.header')!;
    expect(header.querySelector('img')).toBeNull();
  });

  it('renders the new category from the payload on a sibling-slug navigation, without refetching it', async () => {
    const { fixture, push, getBySlug, list } = await renderLive();

    await push(
      buildPayload({
        category: {
          ...SAMPLE_CATEGORY,
          id: 'cat-video',
          slug: 'fx-video',
          name: 'Video',
        } as unknown as CatalogCategoryLoadPayload['category'],
      }),
    );

    const heading = (fixture.nativeElement as HTMLElement).querySelector('h1.title');
    expect(heading?.textContent).toContain('Video');
    expect(getBySlug).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('does not fetch products itself on a filter change', async () => {
    const { fixture, list, navigate } = await renderLive();
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
    expect(list).not.toHaveBeenCalled();
  });

  it('does not fetch products itself on a sort change', async () => {
    const { fixture, list, navigate } = await renderLive();
    const component = fixture.componentInstance as unknown as {
      onSortChange(c: { key: string; sortBy: string; sortOrder: string }): void;
    };
    component.onSortChange({ key: 'priceAsc', sortBy: 'price', sortOrder: 'asc' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(navigate).toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('keeps the category name in the document title after the loader emits', async () => {
    const { push } = await renderLive();
    await push(
      buildPayload({
        category: {
          ...SAMPLE_CATEGORY,
          id: 'cat-video',
          slug: 'fx-video',
          name: 'Video',
        } as unknown as CatalogCategoryLoadPayload['category'],
      }),
    );
    expect(document.title).toContain('Video');
  });
});

/**
 * Finding C10, category half (plan L Phase L2).
 *
 * The category loader soft-fails its products fetch to an empty array, which is
 * right for the page but was rendered as "no products in this category". It now
 * carries the failure so the page says so and offers a retry.
 */
describe('CatalogCategoryPage load failure', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  it('renders the localized error block instead of the empty state', async () => {
    const fixture = await renderPage({
      locale: 'en',
      payload: { ...buildPayload({ products: [], totalCount: 0 }), productsError: true },
    });
    const root = fixture.nativeElement as HTMLElement;
    const error = root.querySelector('[data-testid="catalog-error"]');
    expect(error).not.toBeNull();
    expect(error?.textContent).toContain(getChromeStrings('en').catalog.loadError);
    expect(root.querySelector('[data-testid="catalog-grid-empty"]')).toBeNull();
    expect(root.querySelector('[data-testid="catalog-error-retry"]')).not.toBeNull();
  });

  it('renders the French copy under /fr', async () => {
    const fixture = await renderPage({
      locale: 'fr',
      payload: { ...buildPayload({ products: [], totalCount: 0 }), productsError: true },
    });
    const error = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="catalog-error"]',
    );
    expect(error?.textContent).toContain(getChromeStrings('fr').catalog.loadError);
  });

  it('keeps the empty state for a genuinely empty category', async () => {
    const fixture = await renderPage({
      locale: 'en',
      payload: buildPayload({ products: [], totalCount: 0 }),
    });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="catalog-error"]')).toBeNull();
    expect(root.querySelector('[data-testid="catalog-grid-empty"]')).not.toBeNull();
  });

  it('clears the error flag when the retry succeeds', async () => {
    const fixture = await renderPage({
      locale: 'en',
      payload: { ...buildPayload({ products: [], totalCount: 0 }), productsError: true },
    });
    const component = fixture.componentInstance as unknown as { retry(): void };
    component.retry();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="catalog-error"]')).toBeNull();
    expect(root.querySelector('[data-testid="catalog-grid"]')).not.toBeNull();
  });
});
