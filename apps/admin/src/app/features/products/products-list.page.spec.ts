import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { ProductsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { provideCurrencyStoreStub } from '../../../testing/currency-store.mock';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';
import { ProductsListPage } from './products-list.page';

expect.extend(toHaveNoViolations);

describe('ProductsListPage', () => {
  let fixture: ComponentFixture<ProductsListPage>;
  let page: ProductsListPage;
  let listSpy: jest.Mock;
  let queryParams$: BehaviorSubject<Record<string, string>>;

  const fixtureResponse = {
    data: [
      {
        id: 'prod-1',
        name: { default: 'Backpack', en: 'Backpack' },
        slug: 'backpack',
        status: 'ACTIVE',
        createdAt: '2026-04-01T10:00:00.000Z',
        updatedAt: '2026-04-01T10:00:00.000Z',
        variants: [{ id: 'v-1', sku: 'SKU-1', price: 100, isActive: true, isDefault: true }],
      },
    ],
    meta: { page: 1, pageSize: 20, total: 1 },
  };

  function configure(
    params: Record<string, string> = {},
    permissions = new Set<string>(['products:view', 'products:update', 'products:create']),
  ) {
    queryParams$ = new BehaviorSubject<Record<string, string>>(params);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: ProductsService, useValue: { listProducts: listSpy } },
        {
          provide: AuthStore,
          useValue: {
            locale: () => 'fr',
            hasPermission: (p: string) => permissions.has(p),
            hasAnyPermission: (ps: string[]) => ps.some((p) => permissions.has(p)),
          },
        },
        provideCurrencyStoreStub(),
        provideStoreSettingsStub(),
        {
          provide: ActivatedRoute,
          useValue: { queryParams: queryParams$.asObservable() },
        },
      ],
    });
    fixture = TestBed.createComponent(ProductsListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('fetches with default paging', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure();
    expect(listSpy).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(page.total()).toBe(1);
    expect(page.loading()).toBe(false);
  });

  it('forwards a valid status filter, drops an invalid one', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure({ status: 'ACTIVE' });
    expect(listSpy).toHaveBeenCalledWith({ page: 1, pageSize: 20, status: 'ACTIVE' });

    listSpy.mockClear();
    queryParams$.next({ status: 'GARBAGE' });
    expect(listSpy).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it('surfaces ApiForbiddenError with a permission-safe message', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('surfaces ApiNotFoundError as the products-not-found error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Products not found.');
  });

  it('setStatus writes status + resets page via the router', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure();
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockReturnValue(Promise.resolve(true));
    page.setStatus('DRAFT');
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { status: 'DRAFT', page: null },
        queryParamsHandling: 'merge',
      }),
    );
  });

  // A1: the price cell used to be formatted with a hardcoded 'USD', so the
  // store currency was shown as US$100.00.
  it('renders prices in the store currency, never in dollars', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('XTS ');
    expect(text).not.toMatch(/US\$|\$\d/);
  });

  it('defaultVariantPrice prefers the isDefault variant', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure();
    const price = page.defaultVariantPrice({
      id: 'p',
      name: 'x',
      slug: 'x',
      status: 'ACTIVE',
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-01T10:00:00.000Z',
      variants: [
        { id: 'v-2', sku: 'Y', price: 50, isActive: true, isDefault: false },
        { id: 'v-1', sku: 'X', price: 100, isActive: true, isDefault: true },
      ],
    } as never);
    expect(price).toBe(100);
  });

  it('has no axe violations on the loaded table', async () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('toggleRow adds and removes ids from the selection', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure();
    expect(page.selectedCount()).toBe(0);
    page.toggleRow('prod-1');
    expect(page.isSelected('prod-1')).toBe(true);
    expect(page.selectedCount()).toBe(1);
    page.toggleRow('prod-1');
    expect(page.isSelected('prod-1')).toBe(false);
    expect(page.selectedCount()).toBe(0);
  });

  it('toggleAllVisible selects every visible row then clears them', () => {
    const twoRows = {
      data: [
        { ...fixtureResponse.data[0] },
        {
          id: 'prod-2',
          name: { default: 'Bottle' },
          slug: 'bottle',
          status: 'DRAFT',
          createdAt: '2026-04-01T10:00:00.000Z',
          updatedAt: '2026-04-01T10:00:00.000Z',
          variants: [{ id: 'v-2', sku: 'S2', price: 20, isActive: true, isDefault: true }],
        },
      ],
      meta: { page: 1, pageSize: 20, total: 2 },
    };
    listSpy = jest.fn(() => of(twoRows));
    configure();
    page.toggleAllVisible(true);
    expect(page.selectedCount()).toBe(2);
    expect(page.allVisibleSelected()).toBe(true);
    page.toggleAllVisible(false);
    expect(page.selectedCount()).toBe(0);
  });

  it('partiallySelected flips on when a subset of rows is picked', () => {
    const twoRows = {
      data: [
        { ...fixtureResponse.data[0] },
        {
          id: 'prod-2',
          name: { default: 'Bottle' },
          slug: 'bottle',
          status: 'DRAFT',
          createdAt: '2026-04-01T10:00:00.000Z',
          updatedAt: '2026-04-01T10:00:00.000Z',
          variants: [{ id: 'v-2', sku: 'S2', price: 20, isActive: true, isDefault: true }],
        },
      ],
      meta: { page: 1, pageSize: 20, total: 2 },
    };
    listSpy = jest.fn(() => of(twoRows));
    configure();
    page.toggleRow('prod-1');
    expect(page.partiallySelected()).toBe(true);
    expect(page.allVisibleSelected()).toBe(false);
    page.toggleRow('prod-2');
    expect(page.partiallySelected()).toBe(false);
    expect(page.allVisibleSelected()).toBe(true);
  });

  it('bulk bar keeps its space when selection is empty and reveals a count when not', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure();
    // Present but invisible + out of the a11y tree: removing it from the flow
    // shifted every row down on the first tick (finding E1).
    const hidden = fixture.nativeElement.querySelector('[data-testid="products-bulk-bar"]');
    expect(hidden).toBeTruthy();
    expect(hidden.classList.contains('invisible')).toBe(true);
    expect(hidden.getAttribute('aria-hidden')).toBe('true');
    expect(hidden.hasAttribute('inert')).toBe(true);

    page.toggleRow('prod-1');
    fixture.detectChanges();
    const bar = fixture.nativeElement.querySelector('[data-testid="products-bulk-bar"]');
    expect(bar).toBeTruthy();
    expect(bar.classList.contains('invisible')).toBe(false);
    expect(bar.getAttribute('aria-hidden')).toBeNull();
    expect(bar.hasAttribute('inert')).toBe(false);
    expect(bar.querySelector('[data-testid="products-bulk-bar-count"]')?.textContent).toContain(
      '1',
    );
  });

  it('clearSelection empties the selection', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure();
    page.toggleRow('prod-1');
    expect(page.selectedCount()).toBe(1);
    page.clearSelection();
    expect(page.selectedCount()).toBe(0);
  });

  it('selection drops on refetch triggered by a query-param change', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure();
    page.toggleRow('prod-1');
    expect(page.selectedCount()).toBe(1);
    queryParams$.next({ status: 'ACTIVE' });
    expect(page.selectedCount()).toBe(0);
  });

  // ── Request indexing (DR-17 D2) ───────────────────────────────────────────

  const SEO_PERMS = new Set<string>(['products:view', 'seo:manage']);
  const indexingResponse = {
    dryRun: false,
    targetType: 'products' as const,
    requestedCount: 2,
    results: [
      {
        engine: 'indexnow' as const,
        accepted: true,
        submitted: 2,
        skippedDeduped: 0,
        reason: null,
        submissionId: 's1',
      },
    ],
  };

  function spyDialog(result: unknown = indexingResponse) {
    return jest.spyOn(page['dialog'], 'open').mockReturnValue({ closed: of(result) } as never);
  }

  it('renders the row-level Request indexing button only with seo:manage', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure({}, SEO_PERMS);
    expect(
      fixture.nativeElement.querySelector('[data-testid="product-row-indexing-prod-1"]'),
    ).not.toBeNull();
  });

  it('hides the row-level Request indexing button without seo:manage', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure(); // default perms exclude seo:manage
    expect(
      fixture.nativeElement.querySelector('[data-testid="product-row-indexing-prod-1"]'),
    ).toBeNull();
  });

  it('row Request indexing opens the dialog with the single productId', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure({}, SEO_PERMS);
    const open = spyDialog();
    page.openRowIndexingDialog(fixtureResponse.data[0] as never);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][1].data.request).toEqual({ productIds: ['prod-1'] });
  });

  it('row Request indexing announces a re-crawl success, never "reindexed"', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure({}, SEO_PERMS);
    spyDialog();
    page.openRowIndexingDialog(fixtureResponse.data[0] as never);
    expect(page.announcement()).toMatch(/re-crawl/i);
    expect(page.announcement()).not.toMatch(/reindex/i);
  });

  it('shows a Request indexing bulk button (with count) when seo:manage + selection', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure({}, SEO_PERMS);
    page.toggleRow('prod-1');
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('[data-testid="products-bulk-bar-indexing"]');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('1');
  });

  it('bulk Request indexing opens the dialog with all selected ids and clears selection', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure({}, SEO_PERMS);
    page.toggleRow('prod-1');
    const open = spyDialog();
    page.openBulkIndexingDialog();
    expect(open.mock.calls[0][1].data.request).toEqual({ productIds: ['prod-1'] });
    expect(page.selectedCount()).toBe(0); // bulk submit clears selection
  });

  it('emptyColspan accounts for the select + actions columns', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure({}, SEO_PERMS); // canSelect (seo:manage) + canSeoManage → 5 + 1 + 1
    expect(page.emptyColspan()).toBe(7);
  });

  it('is axe-clean with the indexing actions rendered', async () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure({}, SEO_PERMS);
    page.toggleRow('prod-1');
    fixture.detectChanges();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });

  it('row Request indexing cancel (null result) announces nothing', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure({}, SEO_PERMS);
    spyDialog(null);
    page.openRowIndexingDialog(fixtureResponse.data[0] as never);
    expect(page.announcement()).toBeNull();
  });

  it('bulk Request indexing cancel (null result) preserves the selection', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure({}, SEO_PERMS);
    page.toggleRow('prod-1');
    spyDialog(null);
    page.openBulkIndexingDialog();
    expect(page.selectedCount()).toBe(1); // unlike a successful bulk submit, cancel keeps the selection
  });

  // ── QA D3: a search box over 845 products ─────────────────────────────────

  it('renders a search box seeded from the search URL param', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure({ search: 'honey' });
    const input = fixture.nativeElement.querySelector(
      '[data-testid="products-search"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.value).toBe('honey');
    expect(listSpy).toHaveBeenCalledWith({ page: 1, pageSize: 20, search: 'honey' });
  });

  it('onSearch debounces then writes search + resets page', (done) => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure();
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockReturnValue(Promise.resolve(true));
    page.onSearch({ target: { value: 'honey' } } as unknown as Event);
    setTimeout(() => {
      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          queryParams: { search: 'honey', page: null },
          queryParamsHandling: 'merge',
        }),
      );
      done();
    }, 300);
  });

  it('clears the bulk selection when the search term changes', () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure();
    page.toggleRow('prod-1');
    expect(page.selectedCount()).toBe(1);
    // A filtered re-fetch must not keep rows the operator can no longer see.
    queryParams$.next({ search: 'honey' });
    expect(page.selectedCount()).toBe(0);
  });

  it('has no axe violations with the search box rendered', async () => {
    listSpy = jest.fn(() => of(fixtureResponse));
    configure({ search: 'honey' });
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
