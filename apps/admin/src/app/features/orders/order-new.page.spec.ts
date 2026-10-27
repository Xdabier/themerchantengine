import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { signal } from '@angular/core';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ADMIN_API_BASE_URL } from '@admin-services';
import { OrderNewPage } from './order-new.page';
import { AuthStore } from '../../core/stores/auth.store';
import { provideCurrencyStoreStub } from '../../../testing/currency-store.mock';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';

expect.extend(toHaveNoViolations);

const TS = '2026-04-20T00:00:00.000Z';

function product(
  id: string,
  name: Record<string, string>,
  slug: string,
  variants: Array<{ id: string; sku: string; price: number; isActive?: boolean }>,
) {
  return {
    id,
    name,
    slug,
    status: 'ACTIVE',
    createdAt: TS,
    updatedAt: TS,
    variants: variants.map((v, i) => ({ isActive: true, isDefault: i === 0, ...v })),
  };
}

describe('OrderNewPage', () => {
  const authStub = {
    hasPermission: () => true,
    currentUser: signal(null),
    permissions: signal<string[]>([]),
    locale: signal('fr'),
    isAuthenticated: signal(true),
    effectivePermissions: () => [] as string[],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'orders/new', component: OrderNewPage },
          { path: 'orders/:id', component: OrderNewPage },
        ]),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        { provide: AuthStore, useValue: authStub },
        provideCurrencyStoreStub(),
        provideStoreSettingsStub(),
      ],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    TestBed.inject(HttpTestingController).verify();
  });

  function flushCountries(http: HttpTestingController, defaultCode = 'FR'): void {
    http
      .expectOne((r) => r.url.includes('/v1/admin/countries'))
      .flush({
        data: {
          data: [
            {
              code: 'FR',
              name: 'France',
              region: 'Middle East',
              emoji: '🇫🇷',
              enabled: true,
              isDefault: defaultCode === 'FR',
            },
            {
              code: 'AE',
              name: 'United Arab Emirates',
              region: 'Middle East',
              emoji: '🇦🇪',
              enabled: true,
              isDefault: defaultCode === 'AE',
            },
          ],
          defaultCode,
        },
      });
  }

  function flushMethods(http: HttpTestingController): void {
    http
      .expectOne((r) => r.url.includes('/v1/admin/shipping/methods'))
      .flush({
        data: [
          {
            id: 'm-std',
            zoneId: 'z1',
            name: { default: 'Standard' },
            type: 'FLAT_RATE',
            price: 10,
            isActive: true,
            isDefault: true,
            sortOrder: 0,
            createdAt: TS,
            updatedAt: TS,
          },
          {
            id: 'm-exp',
            zoneId: 'z1',
            name: { default: 'Express' },
            type: 'FLAT_RATE',
            price: 30,
            isActive: true,
            isDefault: false,
            sortOrder: 1,
            createdAt: TS,
            updatedAt: TS,
          },
        ],
        meta: { page: 1, pageSize: 100, total: 2 },
      });
  }

  /** The two pickers each prime page 1 on init. */
  function flushPickerPrime(
    http: HttpTestingController,
    products: ReturnType<typeof product>[] = [],
    total = products.length,
  ): void {
    http
      .expectOne((r) => r.url.includes('/v1/admin/products'))
      .flush({ data: products, meta: { page: 1, pageSize: 20, total } });
    http
      .expectOne((r) => r.url.includes('/v1/admin/customers'))
      .flush({
        data: [{ id: 'c1', firstName: 'Aisha', lastName: 'K', email: 'a@x.test' }],
        meta: { page: 1, pageSize: 20, total: 1 },
      });
  }

  /**
   * The pickers only mount once the method fetch clears `loading()`, so the
   * page needs a change-detection pass between the two flush waves.
   */
  function flushLookups(
    harness: RouterTestingHarness,
    http: HttpTestingController,
    products: ReturnType<typeof product>[] = [
      product('p1', { default: 'Widget', en: 'Widget' }, 'widget', [
        { id: 'v1', sku: 'WDG-1', price: 100 },
      ]),
    ],
    total = products.length,
  ): void {
    flushCountries(http);
    flushMethods(http);
    harness.detectChanges();
    flushPickerPrime(http, products, total);
    harness.detectChanges();
  }

  it('preselects the default shipping method and computes live totals', async () => {
    const harness = await RouterTestingHarness.create('/orders/new');
    const cmp = await harness.navigateByUrl('/orders/new', OrderNewPage);
    flushLookups(harness, TestBed.inject(HttpTestingController));
    harness.detectChanges();

    expect(cmp.form.controls.shippingMethodId.value).toBe('m-std');

    cmp.onProductPicked(cmp.itemRows()[0], {
      value: {
        variants: [{ id: 'v1', sku: 'WDG-1', price: 100, isActive: true }],
      },
    } as never);
    cmp.items.at(0).get('quantity')!.setValue(2);
    harness.detectChanges();

    expect(cmp.totals().subtotal).toBe(200);
    expect(cmp.totals().shipping).toBe(10);
    expect(cmp.totals().total).toBe(210);

    // A8: the totals block and the option labels used to read `10.00 EUR`,
    // a third money format built from a hardcoded literal.
    expect(cmp.money(10)).toBe('XTS 10.000');
    const text = (harness.routeNativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('XTS 210.000');
    expect(text).not.toContain('210.000 XTS');
  });

  it('searches the whole catalogue server-side instead of one truncated page', async () => {
    const harness = await RouterTestingHarness.create('/orders/new');
    await harness.navigateByUrl('/orders/new', OrderNewPage);
    const http = TestBed.inject(HttpTestingController);
    flushLookups(harness, http, [], 0);
    harness.detectChanges();

    // C2: 745 of 845 products used to be unreachable, and the count was hidden.
    const primed = (harness.routeNativeElement as HTMLElement).querySelector(
      '[data-testid="order-new-product-0-status"]',
    ) as HTMLElement;
    expect(primed.textContent).toContain('No matches');

    jest.useFakeTimers();
    const input = (harness.routeNativeElement as HTMLElement).querySelector(
      '[data-testid="order-new-product-0"]',
    ) as HTMLInputElement;
    input.value = 'urb';
    input.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(200);

    const req = http.expectOne((r) => r.url.includes('/v1/admin/products'));
    expect(req.request.params.get('search')).toBe('urb');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('pageSize')).toBe('20');
    req.flush({
      data: [
        product('p9', { default: 'Urban Shoe', en: 'Urban Shoe' }, 'urban-shoe', [
          { id: 'v9', sku: 'SHOE-URB-42', price: 250 },
        ]),
      ],
      meta: { page: 1, pageSize: 20, total: 845 },
    });
    harness.detectChanges();

    expect(primed.textContent).toContain('Showing 1 of 845');
  });

  it('populates the row variant select from the picked product only', async () => {
    const harness = await RouterTestingHarness.create('/orders/new');
    const cmp = await harness.navigateByUrl('/orders/new', OrderNewPage);
    const http = TestBed.inject(HttpTestingController);
    flushLookups(harness, http, [
      product('p2', { default: 'Cotton Tee', en: 'Cotton Tee' }, 'cotton-tee', [
        { id: 'v2', sku: 'TEE-S', price: 50 },
        { id: 'v3', sku: 'TEE-L', price: 55 },
        { id: 'v4', sku: 'TEE-XL', price: 60, isActive: false },
      ]),
    ]);
    harness.detectChanges();

    const option = (harness.routeNativeElement as HTMLElement).querySelector(
      '[data-testid="order-new-product-0"]',
    ) as HTMLInputElement;
    option.dispatchEvent(new Event('focus'));
    harness.detectChanges();
    // The picker's options render through the CDK overlay container, which is a
    // sibling of the route element rather than a descendant, so this has to
    // query the document.
    (document.querySelector('[data-entity-option]') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    harness.detectChanges();

    expect(
      cmp
        .itemRows()[0]
        .variants()
        .map((v) => v.label),
    ).toEqual(['TEE-S (XTS 50.000)', 'TEE-L (XTS 55.000)']);
    const select = (harness.routeNativeElement as HTMLElement).querySelector(
      '[data-testid="order-new-variant-0"]',
    ) as HTMLSelectElement;
    expect(select.textContent).toContain('TEE-S');
    expect(select.textContent).not.toContain('TEE-XL');
    // Two variants is a real choice, so nothing is picked for the operator.
    expect(cmp.items.at(0).get('variantId')!.value).toBe('');
    expect(cmp.form.invalid).toBe(true);
  });

  it('auto-selects the only variant a single-variant product has', async () => {
    const harness = await RouterTestingHarness.create('/orders/new');
    const cmp = await harness.navigateByUrl('/orders/new', OrderNewPage);
    flushLookups(harness, TestBed.inject(HttpTestingController));
    harness.detectChanges();

    const input = (harness.routeNativeElement as HTMLElement).querySelector(
      '[data-testid="order-new-product-0"]',
    ) as HTMLInputElement;
    input.dispatchEvent(new Event('focus'));
    harness.detectChanges();
    // The picker's options render through the CDK overlay container, which is a
    // sibling of the route element rather than a descendant, so this has to
    // query the document.
    (document.querySelector('[data-entity-option]') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    harness.detectChanges();

    expect(cmp.items.at(0).get('variantId')!.value).toBe('v1');
  });

  it('POSTs a manual order with the default method and navigates to it', async () => {
    const harness = await RouterTestingHarness.create('/orders/new');
    const cmp = await harness.navigateByUrl('/orders/new', OrderNewPage);
    const http = TestBed.inject(HttpTestingController);
    flushLookups(harness, http);
    harness.detectChanges();

    cmp.items.at(0).get('variantId')!.setValue('v1');
    cmp.form.controls.shippingAddress.patchValue({
      fullName: 'Aisha',
      phone: '+97455551234',
      addressLine1: 'Building 12',
      city: 'Lyon',
      country: 'FR',
    });
    harness.detectChanges();

    const nav = jest.spyOn(TestBed.inject(Router), 'navigate');
    cmp.submit();

    const req = http.expectOne('/api/v1/admin/orders');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.shippingMethodId).toBe('m-std');
    // The picker-only productId never reaches the wire.
    expect(req.request.body.items[0]).toEqual({ variantId: 'v1', quantity: 1 });
    req.flush({ data: { id: 'order-9', status: 'PENDING', createdAt: TS, updatedAt: TS } });

    expect(nav).toHaveBeenCalledWith(['/orders', 'order-9']);
  });

  it('takes the initial country from the store default, not a hardcoded market', async () => {
    const harness = await RouterTestingHarness.create('/orders/new');
    const cmp = await harness.navigateByUrl('/orders/new', OrderNewPage);
    const http = TestBed.inject(HttpTestingController);
    flushCountries(http, 'AE');
    flushMethods(http);
    harness.detectChanges();
    flushPickerPrime(http);
    harness.detectChanges();

    expect(cmp.form.controls.shippingAddress.controls.country.value).toBe('AE');
    const select = (harness.routeNativeElement as HTMLElement).querySelector(
      '[data-testid="country-select"]',
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.textContent).toContain('France (FR)');
  });

  it('resolves the product name through the shared locale picker', async () => {
    const harness = await RouterTestingHarness.create('/orders/new');
    await harness.navigateByUrl('/orders/new', OrderNewPage);
    const http = TestBed.inject(HttpTestingController);
    flushLookups(harness, http, [
      // Only a locale that is neither the operator's, nor `en`, nor `default` is
      // populated: the local resolver this replaced read `en` then `default` and
      // returned an empty name, so the option rendered as a bare SKU. The locale
      // has to stay outside the store pair for the test to keep proving that the
      // resolver reaches its any-populated-value rung.
      product('p1', { default: '', de: 'Zahnbohrer' }, 'sidr', [
        { id: 'v1', sku: 'SIDR-1', price: 90 },
      ]),
    ]);
    harness.detectChanges();

    const input = (harness.routeNativeElement as HTMLElement).querySelector(
      '[data-testid="order-new-product-0"]',
    ) as HTMLInputElement;
    input.dispatchEvent(new Event('focus'));
    harness.detectChanges();

    // Overlay container, not the route element. See the note above.
    const option = document.querySelector('[data-entity-option]') as HTMLElement;
    expect(option.textContent).toContain('Zahnbohrer');
    expect(option.textContent).toContain('SIDR-1');
  });

  it('has no axe violations', async () => {
    const harness = await RouterTestingHarness.create('/orders/new');
    await harness.navigateByUrl('/orders/new', OrderNewPage);
    flushLookups(harness, TestBed.inject(HttpTestingController));
    harness.detectChanges();

    expect(await axe(harness.routeNativeElement!)).toHaveNoViolations();
  });

  it('offers a retry when the boot lookup fails, instead of a dead form', async () => {
    const harness = await RouterTestingHarness.create('/orders/new');
    await harness.navigateByUrl('/orders/new', OrderNewPage);
    const http = TestBed.inject(HttpTestingController);

    flushCountries(http);
    http
      .expectOne((r) => r.url.includes('/v1/admin/shipping/methods'))
      .error(new ProgressEvent('offline'), { status: 503, statusText: 'Service Unavailable' });
    harness.detectChanges();
    // The form still mounts (degraded), so the pickers prime as usual.
    flushPickerPrime(http, []);
    harness.detectChanges();

    const root = harness.routeNativeElement as HTMLElement;
    const error = root.querySelector('[data-testid="order-new-error"]');
    expect(error).toBeTruthy();
    expect(error!.getAttribute('role')).toBe('alert');

    const retry = error!.querySelector(
      '[data-testid="order-new-error-retry"]',
    ) as HTMLButtonElement;
    expect(retry).toBeTruthy();
    retry.click();
    harness.detectChanges();

    // The retry re-fires the lookup rather than asking for a page reload.
    flushMethods(http);
    harness.detectChanges();
    flushPickerPrime(http, []);
    harness.detectChanges();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('[data-testid="order-new-error"]'),
    ).toBeNull();
  });
});
