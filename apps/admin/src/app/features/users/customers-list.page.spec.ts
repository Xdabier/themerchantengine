import { ApiForbiddenError, ApiNotFoundError, ApiServerError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { UsersService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { CustomersListPage } from './customers-list.page';

expect.extend(toHaveNoViolations);

const customers = [
  {
    id: 'c1',
    email: 'a@b.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    roles: [],
    permissions: [],
    status: 'active',
    segment: 'LOYAL',
    orderCount: 12,
    totalSpent: 3200.5,
  },
  {
    id: 'c2',
    email: 'grace@example.com',
    firstName: null,
    lastName: null,
    roles: [],
    permissions: [],
    status: 'active',
    orderCount: 0,
    totalSpent: 0,
  },
];

describe('CustomersListPage', () => {
  let fixture: ComponentFixture<CustomersListPage>;
  let page: CustomersListPage;
  let listSpy: jest.Mock;
  let segmentsSpy: jest.Mock;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: UsersService,
          useValue: { listCustomers: listSpy, listCustomerSegments: segmentsSpy },
        },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: ['customers:view'], roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(CustomersListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listSpy = jest.fn(() =>
      of({ data: customers, meta: { page: 1, pageSize: 20, total: customers.length } }),
    );
    segmentsSpy = jest.fn(() =>
      of([
        { segment: 'LOYAL', count: 5 },
        { segment: 'AT_RISK', count: 2 },
      ]),
    );
  });

  it('loads customers + segment counts on init', () => {
    configure();
    expect(page.rows()).toHaveLength(2);
    expect(page.total()).toBe(2);
    expect(page.countFor('LOYAL')).toBe(5);
  });

  it('setSegment navigates with the new segment + resets page', () => {
    configure();
    const navSpy = jest.spyOn(TestBed.inject(Router), 'navigate');
    page.setSegment('LOYAL');
    expect(navSpy).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ segment: 'LOYAL', page: null }),
      }),
    );
  });

  // ── Plan F, findings F3 + F4 ──────────────────────────────────────────

  it('renders the real order count in the ORDERS cell', () => {
    configure();
    const row = fixture.nativeElement.querySelector(
      '[data-testid="customer-row-c1"]',
    ) as HTMLElement;
    const cells = row.querySelectorAll('td');
    expect(cells[2].textContent?.trim()).toBe('12');
  });

  it('drops the Last login column that had no data source', () => {
    configure();
    const host = fixture.nativeElement as HTMLElement;
    const headers = [...host.querySelectorAll('th')].map((th) => th.textContent?.trim());
    expect(headers).toEqual(['Customer', 'Email', 'Orders', 'Lifetime value', 'Segment']);
    expect(host.textContent).not.toContain('Last login');
  });

  it('offers no VIP or HIGH_VALUE chip, since neither can ever match', () => {
    configure();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="segment-filter-VIP"]')).toBeNull();
    expect(host.querySelector('[data-testid="segment-filter-HIGH_VALUE"]')).toBeNull();
    expect(host.querySelector('[data-testid="segment-filter-LOYAL"]')).toBeTruthy();
  });

  it('onSearch debounces then updates the URL', (done) => {
    configure();
    const router = TestBed.inject(Router);
    const navSpy = jest.spyOn(router, 'navigate');
    page.onSearch({ target: { value: 'ada' } } as unknown as Event);
    setTimeout(() => {
      expect(navSpy).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          queryParams: expect.objectContaining({ search: 'ada' }),
        }),
      );
      done();
    }, 300);
  });

  it('ApiForbiddenError surfaces a permission-safe error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('ApiServerError surfaces the generic retry fallback', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiServerError({ code: 'INTERNAL', message: 'boom', status: 500 })),
    );
    configure();
    expect(page.error()).toMatch(/retry|boom/);
  });

  it('ApiNotFoundError surfaces the customers-not-found error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Customers not found.');
  });

  it('active segment chip renders aria-pressed=true', () => {
    configure();
    const host = fixture.nativeElement as HTMLElement;
    const all = host.querySelector('[data-testid="segment-filter-all"]') as HTMLButtonElement;
    expect(all.getAttribute('aria-pressed')).toBe('true');
    const loyal = host.querySelector('[data-testid="segment-filter-LOYAL"]') as HTMLButtonElement;
    expect(loyal.getAttribute('aria-pressed')).toBe('false');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
