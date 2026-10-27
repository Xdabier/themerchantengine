import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, type ParamMap } from '@angular/router';
import { ApiConflictError, ApiForbiddenError, ApiNotFoundError, ApiError } from '@admin-types';
import { OrdersService, ReviewsService, UsersService } from '@admin-services';
import * as adminUi from '@admin-ui';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { CustomerDetailPage } from './customer-detail.page';

expect.extend(toHaveNoViolations);

const customerFixture = {
  id: 'c1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  roles: [],
  permissions: [],
  status: 'active' as const,
  segment: 'LOYAL' as const,
  orderCount: 12,
  totalSpent: 3200,
  reviewCount: 2,
  addresses: [
    {
      id: 'addr-1',
      label: 'Home',
      fullName: 'Ada Lovelace',
      phone: '+97455512345',
      addressLine1: '12 Corniche',
      addressLine2: null,
      city: 'Lyon',
      state: null,
      postalCode: '0000',
      country: 'QA',
      isDefaultShipping: true,
      isDefaultBilling: false,
    },
  ],
};

const orderFixture = {
  id: 'o1',
  orderNumber: 'ORD-2026-000004',
  status: 'DELIVERED' as const,
  total: 527,
  createdAt: '2026-04-02T10:00:00.000Z',
  updatedAt: '2026-04-02T10:00:00.000Z',
};

const reviewFixture = {
  id: 'rev-1',
  productId: 'p1',
  userId: 'c1',
  rating: 5,
  status: 'PUBLISHED' as const,
  // Admin reads send X-Resolve-Locale: false, so text arrives as Translatable.
  title: { default: "J'ai adoré", fr: "J'ai adoré", en: 'Loved it' },
  body: { default: 'Great product', en: 'Great product' },
  createdAt: '2026-04-03T10:00:00.000Z',
  product: { id: 'p1', slug: 'sidr-honey' },
};

describe('CustomerDetailPage', () => {
  let fixture: ComponentFixture<CustomerDetailPage>;
  let page: CustomerDetailPage;
  let getSpy: jest.Mock;
  let updateSpy: jest.Mock;
  let listOrdersSpy: jest.Mock;
  let listReviewsSpy: jest.Mock;
  let confirmSpy: jest.SpyInstance;
  let paramMap$: BehaviorSubject<ParamMap>;

  function configure(
    id = 'c1',
    perms: string[] = ['customers:view', 'customers:update', 'customers:manage'],
  ) {
    paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({ id }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: UsersService, useValue: { getCustomer: getSpy, updateCustomer: updateSpy } },
        { provide: OrdersService, useValue: { list: listOrdersSpy } },
        { provide: ReviewsService, useValue: { listReviews: listReviewsSpy } },
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$.asObservable() } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(CustomerDetailPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    getSpy = jest.fn(() => of(customerFixture));
    updateSpy = jest.fn((_id: string, body: Record<string, unknown>) =>
      of({ ...customerFixture, ...body }),
    );
    listOrdersSpy = jest.fn(() =>
      of({ data: [orderFixture], meta: { page: 1, pageSize: 10, total: 1 } }),
    );
    listReviewsSpy = jest.fn(() =>
      of({ data: [reviewFixture], meta: { page: 1, pageSize: 10, total: 1 } }),
    );
    confirmSpy = jest.spyOn(adminUi, 'openConfirmDialog').mockResolvedValue(true);
  });

  afterEach(() => confirmSpy.mockRestore());

  it('seeds the form from the loaded customer', () => {
    configure();
    expect(page.form.controls.firstName.value).toBe('Ada');
    expect(page.form.controls.email.value).toBe('ada@example.com');
  });

  it('save PATCHes only dirty fields', () => {
    configure();
    page.form.controls.firstName.setValue('Grace');
    page.form.controls.firstName.markAsDirty();
    page.save();
    expect(updateSpy).toHaveBeenCalledWith('c1', { firstName: 'Grace' });
  });

  it('save is a no-op when pristine', () => {
    configure();
    page.save();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('deactivate requires confirm + sends isActive:false', async () => {
    configure();
    await page.confirmDeactivate();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith('c1', { isActive: false });
  });

  it('409 maps to email conflict', () => {
    updateSpy = jest.fn(() =>
      throwError(
        () => new ApiConflictError({ code: 'EMAIL_TAKEN', message: 'Email already in use' }),
      ),
    );
    configure();
    page.form.controls.email.setValue('taken@example.com');
    page.form.controls.email.markAsDirty();
    page.save();
    expect(page.error()).toContain('Email already in use');
  });

  it('not-found id surfaces a clear error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'Customer not found' })),
    );
    configure('zzz');
    expect(page.error()).toBe('Customer not found.');
  });

  it('reactivate() PATCHes isActive:true without a confirm dialog', () => {
    getSpy = jest.fn(() =>
      of({ ...customerFixture, status: 'inactive' as const, isActive: false }),
    );
    configure();
    page.reactivate();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith('c1', { isActive: true });
  });

  it('cancel in deactivate confirm dialog does not call updateCustomer', async () => {
    confirmSpy.mockResolvedValueOnce(false);
    configure();
    await page.confirmDeactivate();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('403 on save surfaces a permission-safe error', () => {
    updateSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'Forbidden' })),
    );
    configure();
    page.form.controls.firstName.setValue('Grace');
    page.form.controls.firstName.markAsDirty();
    page.save();
    expect(page.error()).toContain('permission');
  });

  it('deactivate server error surfaces a generic error and clears busy', async () => {
    updateSpy = jest.fn(() =>
      throwError(
        () => new ApiError({ code: 'INTERNAL_SERVER_ERROR', message: 'Server error', status: 500 }),
      ),
    );
    configure();
    await page.confirmDeactivate();
    expect(page.error()).toBeTruthy();
    expect(page.busy()).toBe(false);
  });

  it('seeds the phone from the loaded customer record', () => {
    getSpy = jest.fn(() => of({ ...customerFixture, phone: '+971-50-000-0000' }));
    configure();
    expect(page.form.controls.phone.value).toBe('+971-50-000-0000');
  });

  // ── Plan F, finding F5 ──────────────────────────────────────────────────

  it('fetches the customer’s own orders server-side by userId', () => {
    configure();
    expect(listOrdersSpy).toHaveBeenCalledWith(expect.objectContaining({ userId: 'c1' }));
  });

  it('renders each order as a link into the order record', () => {
    configure();
    const link = fixture.nativeElement.querySelector(
      '[data-testid="customer-order-o1"] a',
    ) as HTMLAnchorElement;
    expect(link.textContent?.trim()).toBe('ORD-2026-000004');
    expect(link.getAttribute('href')).toBe('/orders/o1');
  });

  it('renders the addresses that ride along on the detail payload', () => {
    configure();
    const card = fixture.nativeElement.querySelector(
      '[data-testid="customer-address-addr-1"]',
    ) as HTMLElement;
    expect(card.textContent).toContain('12 Corniche');
    expect(card.textContent).toContain('Lyon');
    expect(card.textContent).toContain('Shipping');
  });

  it('renders reviews through the translatable pipe, never as [object Object]', () => {
    configure();
    const card = fixture.nativeElement.querySelector(
      '[data-testid="customer-review-rev-1"]',
    ) as HTMLElement;
    expect(listReviewsSpy).toHaveBeenCalledWith(expect.objectContaining({ userId: 'c1' }));
    expect(card.textContent).toContain("J'ai adoré");
    expect(card.textContent).not.toContain('[object Object]');
  });

  it('shows an empty state per section rather than a blank page', () => {
    listOrdersSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 10, total: 0 } }));
    listReviewsSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 10, total: 0 } }));
    getSpy = jest.fn(() => of({ ...customerFixture, addresses: [] }));
    configure();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('This customer has not ordered yet.');
    expect(host.textContent).toContain('No address on file.');
    expect(host.textContent).toContain('This customer has not reviewed anything.');
  });

  it('says so inline when a section fetch fails, and retries on demand', () => {
    listOrdersSpy = jest.fn(() => throwError(() => new Error('offline')));
    configure();

    const notice = fixture.nativeElement.querySelector(
      '[data-testid="customer-orders-degraded"]',
    ) as HTMLElement;
    expect(notice).toBeTruthy();
    expect(notice.textContent).toContain('Could not load');

    listOrdersSpy.mockReturnValue(
      of({ data: [orderFixture], meta: { page: 1, pageSize: 10, total: 1 } }),
    );
    (
      notice.querySelector('[data-testid="customer-orders-degraded-retry"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(page.ordersError()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="customer-order-o1"]')).toBeTruthy();
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in the error state', async () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'Customer not found' })),
    );
    configure('zzz');
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
