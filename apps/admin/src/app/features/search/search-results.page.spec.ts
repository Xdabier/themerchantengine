import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { GlobalSearchService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { SearchResultsPage } from './search-results.page';

expect.extend(toHaveNoViolations);

const searchFixture = {
  query: 'sneak',
  groups: [
    {
      type: 'product' as const,
      total: 1,
      items: [{ id: 'p1', title: 'Sneaker', subtitle: '/sneaker', url: '/products/p1' }],
    },
    {
      type: 'order' as const,
      total: 0,
      items: [],
    },
  ],
};

describe('SearchResultsPage', () => {
  let fixture: ComponentFixture<SearchResultsPage>;
  let page: SearchResultsPage;
  let searchSpy: jest.Mock;
  let params$: BehaviorSubject<Record<string, string>>;

  function configure(params: Record<string, string> = {}) {
    params$ = new BehaviorSubject<Record<string, string>>(params);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: GlobalSearchService, useValue: { search: searchSpy } },
        { provide: ActivatedRoute, useValue: { queryParams: params$.asObservable() } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: {
        id: 'u',
        email: 'a@b',
        permissions: ['search:view'],
        roles: [],
        status: 'active',
      },
    });
    fixture = TestBed.createComponent(SearchResultsPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    searchSpy = jest.fn(() => of(searchFixture));
  });

  it('skips the API call when q is missing', () => {
    configure();
    expect(searchSpy).not.toHaveBeenCalled();
    expect(page.result()).toBeNull();
  });

  it('fetches results when q is present', () => {
    configure({ q: 'sneak' });
    expect(searchSpy).toHaveBeenCalledWith({ q: 'sneak', limit: 20 });
    expect(page.result()?.groups).toHaveLength(2);
  });

  it('applies the type filter in the API call', () => {
    configure({ q: 'sneak', type: 'product' });
    expect(searchSpy).toHaveBeenCalledWith({ q: 'sneak', limit: 20, types: ['product'] });
    expect(page.visibleGroups()).toHaveLength(1);
  });

  it('totalHits sums group totals', () => {
    configure({ q: 'sneak' });
    expect(page.totalHits()).toBe(1);
  });

  it('ApiForbiddenError surfaces a permission-safe error', () => {
    searchSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure({ q: 'sneak' });
    expect(page.error()).toContain('permission');
  });

  it('ApiNotFoundError surfaces the service-unavailable error', () => {
    searchSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure({ q: 'sneak' });
    expect(page.error()).toBe('Search service unavailable. Try again.');
  });

  it('never shows the route path or the raw id in a result row', () => {
    const uuid = '059c639e-1d1a-4f0e-9a4e-2b7c1f0d8f11';
    searchSpy = jest.fn(() =>
      of({
        query: 'sneak',
        groups: [
          {
            type: 'product' as const,
            total: 1,
            items: [
              {
                id: uuid,
                title: 'Sneaker',
                subtitle: 'SHOE-URB-42 · Active',
                url: `/products/${uuid}`,
              },
            ],
          },
        ],
      }),
    );
    configure({ q: 'sneak' });
    const row = fixture.nativeElement.querySelector(`[data-testid="search-hit-${uuid}"]`);
    expect(row.textContent).toContain('Sneaker');
    expect(row.textContent).toContain('SHOE-URB-42 · Active');
    expect(row.textContent).not.toContain(uuid);
    expect(row.textContent).not.toContain('/products/');
  });

  it('has no axe violations', async () => {
    configure({ q: 'sneak' });
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  // ── QA D4: 20 rows under an "82" badge, with nothing saying so ─────────────

  function groupOf(type: 'product' | 'order' | 'customer' | 'cms', total: number, count: number) {
    return {
      type,
      total,
      items: Array.from({ length: count }, (_, i) => ({
        id: `${type}-${i}`,
        title: `${type} ${i}`,
        subtitle: null,
        url: `/${type}s/${type}-${i}`,
      })),
    };
  }

  it('announces truncation and deep-links into the module list', () => {
    searchSpy = jest.fn(() => of({ query: 'honey', groups: [groupOf('product', 82, 20)] }));
    configure({ q: 'honey' });
    const notice = fixture.nativeElement.querySelector(
      '[data-testid="search-group-truncation-product"]',
    ) as HTMLElement | null;
    expect(notice?.textContent?.replace(/\s+/g, ' ').trim()).toContain('Showing 20 of 82');
    const link = notice?.querySelector('a') as HTMLAnchorElement | null;
    expect(link?.getAttribute('href')).toBe('/products?search=honey');
  });

  it('stays quiet when the group is not truncated', () => {
    searchSpy = jest.fn(() => of({ query: 'honey', groups: [groupOf('product', 3, 3)] }));
    configure({ q: 'honey' });
    expect(
      fixture.nativeElement.querySelector('[data-testid="search-group-truncation-product"]'),
    ).toBeNull();
  });

  it('deep-links orders and customers to their own lists', () => {
    searchSpy = jest.fn(() =>
      of({ query: 'sara', groups: [groupOf('order', 40, 20), groupOf('customer', 30, 20)] }),
    );
    configure({ q: 'sara' });
    const orderLink = fixture.nativeElement.querySelector(
      '[data-testid="search-group-truncation-order"] a',
    ) as HTMLAnchorElement | null;
    const customerLink = fixture.nativeElement.querySelector(
      '[data-testid="search-group-truncation-customer"] a',
    ) as HTMLAnchorElement | null;
    expect(orderLink?.getAttribute('href')).toBe('/orders?search=sara');
    expect(customerLink?.getAttribute('href')).toBe('/customers?search=sara');
  });

  it('gives the cms group a notice but no link (its list has no search param)', () => {
    searchSpy = jest.fn(() => of({ query: 'about', groups: [groupOf('cms', 25, 20)] }));
    configure({ q: 'about' });
    const notice = fixture.nativeElement.querySelector(
      '[data-testid="search-group-truncation-cms"]',
    ) as HTMLElement | null;
    expect(notice?.textContent).toContain('Showing 20 of 25');
    expect(notice?.querySelector('a')).toBeNull();
  });

  it('has no axe violations with a truncation notice rendered', async () => {
    searchSpy = jest.fn(() => of({ query: 'honey', groups: [groupOf('product', 82, 20)] }));
    configure({ q: 'honey' });
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
