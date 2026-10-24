import { ChangeDetectionStrategy, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import axe from 'axe-core';
import { BehaviorSubject, of } from 'rxjs';
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
import CatalogIndexPage from './index.page';
import type { CatalogIndexLoadPayload } from './index.server';
import { fixtureChromeIdentity } from '../../../../test-support/store-config-fixtures';

class StubLocaleService {
  private readonly _locale: WritableSignal<Locale>;

  constructor(initial: Locale) {
    this._locale = signal<Locale>(initial);
  }

  readonly locale = () => this._locale();
  readonly chromeIdentity = () => fixtureChromeIdentity('demo', this._locale());
  readonly strings = () => getChromeStrings(this._locale(), this.chromeIdentity());
  readonly currentUrl = () => `/${this._locale()}/catalog`;
}

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

function buildPayload(overrides: Partial<CatalogIndexLoadPayload> = {}): CatalogIndexLoadPayload {
  return {
    products:
      (overrides.products as CatalogIndexLoadPayload['products']) ??
      (SAMPLE_PRODUCTS as unknown as CatalogIndexLoadPayload['products']),
    totalCount: overrides.totalCount ?? SAMPLE_PRODUCTS.length,
  };
}

async function renderPage(opts: {
  locale: Locale;
  query?: Record<string, string>;
  payload?: CatalogIndexLoadPayload;
}): Promise<ComponentFixture<CatalogIndexPage>> {
  TestBed.overrideComponent(CatalogIndexPage, {
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
      provideRouter([]),
      { provide: LocaleService, useValue: new StubLocaleService(opts.locale) },
      {
        provide: ProductsService,
        useValue: {
          list: vi.fn(async () => ({
            data: SAMPLE_PRODUCTS,
            meta: { page: 1, pageSize: 24, total: SAMPLE_PRODUCTS.length },
          })),
          getBySlug: vi.fn(),
        },
      },
      {
        provide: CategoriesService,
        useValue: {
          list: vi.fn(async () => []),
          getBySlug: vi.fn(),
          listProducts: vi.fn(),
        },
      },
      { provide: STOREFRONT_API_CLIENT, useValue: noopApi },
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
      { provide: Router, useValue: { navigate: vi.fn(async () => true) } },
    ],
  });
  const fixture = TestBed.createComponent(CatalogIndexPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('CatalogIndexPage', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('passes axe-core WCAG 2.2 AA at the component scope', async () => {
    const fixture = await renderPage({ locale: 'en' });
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

  it('renders breadcrumb, generic shop title, category bar, and product grid from the SSR-seeded payload', async () => {
    const fixture = await renderPage({ locale: 'en' });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('app-breadcrumb')).not.toBeNull();
    expect(root.querySelector('h1.title')?.textContent?.trim()).toBe('Shop');
    expect(root.querySelector('catalog-category-bar')).not.toBeNull();
    expect(root.querySelector('[data-testid="catalog-grid"]')).not.toBeNull();
  });

  it('does not call productsSvc.list on a fresh ?page=1 deep-link (page 1 seeded by SSR)', async () => {
    await renderPage({ locale: 'en' });
    const productsSvc = TestBed.inject(ProductsService) as unknown as {
      list: ReturnType<typeof vi.fn>;
    };
    expect(productsSvc.list).not.toHaveBeenCalled();
  });

  it('forwards sort + filter URL params on the page-append fetch', async () => {
    const fixture = await renderPage({
      locale: 'en',
      payload: buildPayload({ totalCount: 100 }),
      query: {
        sortBy: 'price',
        sortOrder: 'asc',
        brand: 'Echo',
        minPrice: '100',
        maxPrice: '500',
      },
    });
    const productsSvc = TestBed.inject(ProductsService) as unknown as {
      list: ReturnType<typeof vi.fn>;
    };
    expect(productsSvc.list).not.toHaveBeenCalled();
    // Sort and filter gestures navigate and let the loader answer, so the
    // append is the only browser-side fetch left to carry the URL params.
    const component = fixture.componentInstance as unknown as { onLoadMore(): void };
    component.onLoadMore();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(productsSvc.list).toHaveBeenCalled();
    const args = productsSvc.list.mock.calls[productsSvc.list.mock.calls.length - 1]?.[0];
    expect(args).toMatchObject({
      sortBy: 'price',
      sortOrder: 'asc',
      brand: 'Echo',
      minPrice: 100,
      maxPrice: 500,
    });
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
      fixture: ComponentFixture<CatalogIndexPage>;
      list: ReturnType<typeof vi.fn>;
    }> {
      TestBed.overrideComponent(CatalogIndexPage, {
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
      // Page 1 is seeded by SSR — mirror that seed in the load payload so
      // pagination append/restore paths line up with the production flow.
      const payload: CatalogIndexLoadPayload = {
        products: buildPage(1) as unknown as CatalogIndexLoadPayload['products'],
        totalCount: opts.total,
      };
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          { provide: LocaleService, useValue: new StubLocaleService('en') },
          { provide: ProductsService, useValue: { list, getBySlug: vi.fn() } },
          {
            provide: CategoriesService,
            useValue: { list: vi.fn(async () => []), getBySlug: vi.fn(), listProducts: vi.fn() },
          },
          { provide: STOREFRONT_API_CLIENT, useValue: noopApi },
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
          { provide: Router, useValue: { navigate: vi.fn(async () => true) } },
        ],
      });
      const fixture = TestBed.createComponent(CatalogIndexPage);
      fixture.detectChanges();
      // Drain enough microtask cycles for the longest restoreFromPage2 chain
      // (9 sequential `await`s for ?page=10) plus initial bootstrap.
      for (let i = 0; i < 15; i += 1) {
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

    it('caps deep-link restoration at MAX_RESTORE_PAGES (10), starting from page 2', async () => {
      const { fixture, list } = await renderWithMultiPage({
        total: 24 * 15,
        query: { page: '15' },
      });
      const cards = fixture.nativeElement.querySelectorAll(
        '[data-testid="catalog-grid"] li[data-product-slug]',
      );
      expect(cards.length).toBe(24 * 10);
      const pages = list.mock.calls.map((c) => c[0]?.page);
      // Page 1 is seeded by SSR; restore fetches pages 2..10 only.
      expect(pages).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
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
      const pages = list.mock.calls.map((c) => c[0]?.page);
      expect(pages).toEqual([2, 3]);
    });

    it('renders no sentinel button once products().length === total', async () => {
      const { fixture } = await renderWithMultiPage({
        total: 24,
        query: { page: '1' },
      });
      expect(
        fixture.nativeElement.querySelector('[data-testid="catalog-load-more-button"]'),
      ).toBeNull();
    });
  });
});

/**
 * Finding C7 behaviour half (plan K Phase K4).
 *
 * The sort select seeds itself to "Newest" on first load, but no query builder
 * sent a sort unless the URL carried one, so the API fell back to
 * `sortOrder asc`. Every product's sortOrder is 0, so the real order was
 * unspecified and Postgres physical order decided it: the label lied, and
 * page 2 of an unspecified order can repeat or skip rows.
 *
 * SSR seeds page 1, so the builder under test here is the one every later page
 * and every browser refetch goes through.
 */
describe('CatalogIndexPage default sort', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  async function lastQueryAfterLoadMore(
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
    // The builder reads the route snapshot, not this call. The append is the
    // browser-side fetch that goes through it.
    const component = fixture.componentInstance as unknown as { onLoadMore(): void };
    component.onLoadMore();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(productsSvc.list).toHaveBeenCalled();
    const calls = productsSvc.list.mock.calls;
    return calls[calls.length - 1]?.[0] as Record<string, unknown>;
  }

  it('asks for the newest products when the URL carries no sort', async () => {
    expect(await lastQueryAfterLoadMore()).toMatchObject({
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
  });

  it('lets an explicit URL sort win', async () => {
    expect(await lastQueryAfterLoadMore({ sortBy: 'price', sortOrder: 'asc' })).toMatchObject({
      sortBy: 'price',
      sortOrder: 'asc',
    });
  });

  it('falls back to newest when the URL sort is not one the control offers', async () => {
    // The select maps anything outside its three explicit pairs back to
    // "Newest", so the request has to agree or the label lies again.
    expect(await lastQueryAfterLoadMore({ sortBy: 'bogus', sortOrder: 'sideways' })).toMatchObject({
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
  });
});

/**
 * Finding C1 / C7 (plan L Phase L1).
 *
 * The route re-resolves the loader on every query-param change, so the payload
 * that lands after a filter or sort gesture is already filtered. The page used
 * to seed its signals once at field-initialiser time and then refetch from the
 * pre-navigation `route.snapshot`, so the grid was overwritten with the old
 * filters. The loader is the only writer now.
 */
describe('CatalogIndexPage loader-driven refetch', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  async function renderLive(initialQuery: Record<string, string> = {}): Promise<{
    fixture: ComponentFixture<CatalogIndexPage>;
    push: (payload: CatalogIndexLoadPayload, query?: Record<string, string>) => Promise<void>;
    list: ReturnType<typeof vi.fn>;
    navigate: ReturnType<typeof vi.fn>;
  }> {
    TestBed.overrideComponent(CatalogIndexPage, {
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
    const data$ = new BehaviorSubject<{ load: CatalogIndexLoadPayload }>({ load: first });
    const snapshot = {
      paramMap: convertToParamMap({}),
      queryParamMap: convertToParamMap(initialQuery),
      data: { load: first },
    };
    const list = vi.fn(async () => ({
      data: SAMPLE_PRODUCTS,
      meta: { page: 1, pageSize: 24, total: SAMPLE_PRODUCTS.length },
    }));
    const navigate = vi.fn(async () => true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LocaleService, useValue: new StubLocaleService('en') },
        { provide: ProductsService, useValue: { list, getBySlug: vi.fn() } },
        {
          provide: CategoriesService,
          useValue: { list: vi.fn(async () => []), getBySlug: vi.fn(), listProducts: vi.fn() },
        },
        { provide: STOREFRONT_API_CLIENT, useValue: noopApi },
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
    const fixture = TestBed.createComponent(CatalogIndexPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // The router updates the snapshot before it emits the resolved data, so the
    // push helper does the same or the page would read stale params.
    const push = async (payload: CatalogIndexLoadPayload, query?: Record<string, string>) => {
      snapshot.queryParamMap = convertToParamMap(query ?? initialQuery);
      snapshot.data = { load: payload };
      data$.next({ load: payload });
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, push, list, navigate };
  }

  function gridSlugs(fixture: ComponentFixture<CatalogIndexPage>): string[] {
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
        products: [SAMPLE_PRODUCTS[0]] as unknown as CatalogIndexLoadPayload['products'],
        totalCount: 1,
      }),
      { specs: 'materiau:metal' },
    );

    expect(gridSlugs(fixture)).toEqual(['echo-buds-pro']);
    const results = (fixture.nativeElement as HTMLElement).querySelector('.results');
    expect(results?.textContent?.trim()).toContain('1');
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

  it('reflects the new URL in the sort control after the loader emits', async () => {
    const { fixture, push } = await renderLive();
    await push(buildPayload(), { sortBy: 'price', sortOrder: 'asc' });
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      'catalog-sort-control select',
    ) as HTMLSelectElement | null;
    expect(select?.value).toBe('priceAsc');
  });
});

/**
 * Finding C11, absorbing the prior pass's C5 (plan L Phase L5).
 *
 * The rail derived its brand list from the products on screen, which is a
 * page-1 sample of the already-filtered result, so choosing a brand collapsed
 * the facet to that brand. Brands come from the payload now.
 */
describe('CatalogIndexPage brand facet', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  function brandValues(fixture: ComponentFixture<CatalogIndexPage>): string[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
        'catalog-filter-rail input[name="brand"]',
      ),
    ).map((input) => input.value);
  }

  it('renders every brand the payload carries, not only the ones on screen', async () => {
    const fixture = await renderPage({
      locale: 'en',
      payload: {
        ...buildPayload({
          products: [SAMPLE_PRODUCTS[0]] as unknown as CatalogIndexLoadPayload['products'],
          totalCount: 1,
        }),
        brandFacets: [
          { brand: 'Echo', count: 4 },
          { brand: 'Sonic', count: 2 },
          { brand: 'Zephyr', count: 1 },
        ],
      },
      query: { brand: 'Echo' },
    });
    expect(brandValues(fixture)).toEqual(['Echo', 'Sonic', 'Zephyr']);
  });

  it('renders no brand fieldset when the payload carries no brands', async () => {
    const fixture = await renderPage({
      locale: 'en',
      payload: { ...buildPayload(), brandFacets: [] },
    });
    expect(brandValues(fixture)).toEqual([]);
  });
});
