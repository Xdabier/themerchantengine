import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, ParamMap, convertToParamMap, provideRouter } from '@angular/router';
import { CountriesService, OrdersService, ProductsService } from '@admin-services';
import { ApiConflictError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';
import { provideCurrencyStoreStub } from '../../../testing/currency-store.mock';
import { OrderEditPage } from './order-edit.page';

describe('OrderEditPage', () => {
  let fixture: ComponentFixture<OrderEditPage>;
  let page: OrderEditPage;
  let getSpy: jest.Mock;
  let editSpy: jest.Mock;
  let listProductsSpy: jest.Mock;
  let paramMap$: BehaviorSubject<ParamMap>;

  const itemsFixture = [
    {
      id: 'item-1',
      productName: {
        default: 'Fraise dentaire 012',
        fr: 'Fraise dentaire 012',
        en: 'Dental bur 012',
      },
      sku: 'SIDR-500',
      quantity: 2,
      unitPrice: 90,
      total: 180,
    },
    {
      id: 'item-2',
      productName: { default: 'Cotton Tee', en: 'Cotton Tee' },
      sku: 'TEE-S',
      quantity: 1,
      unitPrice: 50,
      total: 50,
    },
  ];

  const orderFixture = {
    id: 'order-1',
    orderNumber: 'ORD-2026-000001',
    status: 'PENDING',
    paymentStatus: 'PENDING',
    subtotal: 100,
    shippingAmount: 0,
    taxAmount: 0,
    total: 100,
    discountAmount: 0,
    currency: 'USD',
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
    userId: 'u-1',
    items: itemsFixture,
  };

  const productsPage = {
    data: [
      {
        id: 'p-9',
        name: { default: 'Urban Shoe', en: 'Urban Shoe' },
        slug: 'urban-shoe',
        status: 'ACTIVE' as const,
        createdAt: '2026-04-01T10:00:00.000Z',
        updatedAt: '2026-04-01T10:00:00.000Z',
        variants: [
          { id: 'v-9', sku: 'SHOE-URB-42', price: 250, isActive: true, isDefault: true },
          { id: 'v-10', sku: 'SHOE-URB-44', price: 250, isActive: true, isDefault: false },
        ],
      },
    ],
    meta: { page: 1, pageSize: 20, total: 845 },
  };

  const countriesFixture = {
    data: [
      {
        code: 'FR',
        name: 'France',
        region: 'Middle East',
        emoji: '🇫🇷',
        enabled: true,
        isDefault: true,
      },
      {
        code: 'FR',
        name: 'France',
        region: 'Europe',
        emoji: '🇫🇷',
        enabled: false,
        isDefault: false,
      },
    ],
    defaultCode: 'FR',
  };

  function configure(
    id: string | null = 'order-1',
    countries: ReturnType<jest.Mock> = of(countriesFixture),
  ) {
    paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap(id ? { id } : {}));
    listProductsSpy = jest.fn(() => of(productsPage));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: OrdersService, useValue: { get: getSpy, edit: editSpy } },
        { provide: CountriesService, useValue: { listCached: () => countries } },
        {
          provide: ProductsService,
          useValue: { listProducts: listProductsSpy, getProduct: jest.fn() },
        },
        { provide: AuthStore, useValue: { locale: signal('fr'), hasPermission: () => true } },
        provideStoreSettingsStub(),
        // The page now reads CurrencyStore for its money `step`, and the real
        // store injects AuthStore and fetches on hydrate. The stub keeps this
        // spec about order editing rather than about currency hydration.
        provideCurrencyStoreStub(),
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$.asObservable() } },
      ],
    });
    fixture = TestBed.createComponent(OrderEditPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('mounts and loads the order for the route :id', () => {
    getSpy = jest.fn(() => of(orderFixture));
    editSpy = jest.fn();
    configure('order-1');
    expect(getSpy).toHaveBeenCalledWith('order-1');
    expect(page.order()?.id).toBe('order-1');
  });

  it('surfaces ApiForbiddenError on fetch as a permission banner', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    editSpy = jest.fn();
    configure('order-1');
    expect(page.error()).toContain('permission');
  });

  it('surfaces ApiNotFoundError on fetch as the order-not-found banner', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    editSpy = jest.fn();
    configure('order-missing');
    expect(page.error()).toBe('Order not found.');
  });

  it('describes what the page actually does, with no line-id wording', () => {
    getSpy = jest.fn(() => of(orderFixture));
    editSpy = jest.fn();
    configure('order-1');
    const intro = fixture.nativeElement.querySelector('header p:last-of-type') as HTMLElement;
    // B7: the internal-line-id sentence stays gone. C1: the items promise is
    // honest again now that the editor beneath it exists.
    expect(intro.textContent).not.toContain('line id');
    expect(intro.textContent).toContain('Add or remove items');
    expect(intro.textContent).toContain('shipping address');
  });

  // ── QA C1: the promised items editor ────────────────────────────────────────

  function itemRows(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="order-edit-item-"]'));
  }
  function submitButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid=order-edit-submit] button');
  }
  function pickVariant(id: string): void {
    page.onAddVariantPicked({ target: { value: id } } as unknown as Event);
  }
  function loaded(order: Record<string, unknown> = orderFixture) {
    getSpy = jest.fn(() => of(order));
    editSpy = jest.fn(() => of({ ...order, items: [] }));
    configure('order-1');
  }

  it('renders one row per order item with a readable name, sku, qty and price', () => {
    loaded();
    const rows = itemRows();
    expect(rows).toHaveLength(2);
    // The Translatable arrives raw on admin reads; binding it directly would
    // print "[object Object]".
    expect(rows[0].textContent).toContain('Fraise dentaire 012');
    expect(rows[0].textContent).not.toContain('object Object');
    expect(rows[0].textContent).toContain('SIDR-500');
    expect(rows[0].textContent).toContain('2');
    expect(rows[0].textContent).toContain('USD 90.00');
  });

  it('queues a removal without touching the server until save', () => {
    loaded();
    expect(page.isPendingRemoval('item-1')).toBe(false);
    page.toggleRemoval('item-1');
    fixture.detectChanges();
    expect(page.isPendingRemoval('item-1')).toBe(true);
    expect(editSpy).not.toHaveBeenCalled();

    page.toggleRemoval('item-1');
    expect(page.isPendingRemoval('item-1')).toBe(false);
  });

  it('queues an addition from the picker and drops it again on demand', () => {
    loaded();
    page.onAddProductPicked({ value: productsPage.data[0] } as never);
    // Two active variants is a real choice, so nothing is picked for the operator.
    expect(page.addVariantId()).toBe('');
    pickVariant('v-9');
    page.stageAddition();
    expect(page.addQueue()).toEqual([
      expect.objectContaining({ variantId: 'v-9', quantity: 1, label: 'SHOE-URB-42' }),
    ]);

    page.removeAddition(0);
    expect(page.addQueue()).toEqual([]);
  });

  it('sends addItems and removeItems only when the queues are non-empty', () => {
    loaded();
    page.submit();
    expect(editSpy.mock.calls[0][1]).not.toHaveProperty('addItems');
    expect(editSpy.mock.calls[0][1]).not.toHaveProperty('removeItems');

    page.toggleRemoval('item-2');
    page.onAddProductPicked({ value: productsPage.data[0] } as never);
    pickVariant('v-9');
    page.stageAddition();
    page.submit();
    expect(editSpy.mock.calls[1][1]).toMatchObject({
      addItems: [{ variantId: 'v-9', quantity: 1 }],
      removeItems: [{ orderItemId: 'item-2' }],
    });
  });

  // ── QA C7 for this page: no Save on a pristine form ─────────────────────────

  it('disables Save on a pristine form and enables it once a queue fills', () => {
    loaded();
    expect(submitButton().disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('No changes');

    page.toggleRemoval('item-1');
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Unsaved changes');
  });

  it('enables Save on a form edit alone', () => {
    loaded();
    page.form.controls.manualDiscount.setValue(5);
    page.form.controls.manualDiscount.markAsDirty();
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(false);
  });

  it('clears both queues after a successful save', () => {
    loaded();
    page.toggleRemoval('item-1');
    page.onAddProductPicked({ value: productsPage.data[0] } as never);
    pickVariant('v-9');
    page.stageAddition();
    page.submit();
    expect(page.addQueue()).toEqual([]);
    expect(page.isPendingRemoval('item-1')).toBe(false);
    expect(page.itemsDirty()).toBe(false);
  });

  // ── QA C1 sibling: the whole page is a dead end outside EDITABLE_STATUSES ───

  it('locks the form and explains itself on a DELIVERED order', () => {
    loaded({ ...orderFixture, status: 'DELIVERED' });
    expect(fixture.nativeElement.querySelector('[data-testid=order-edit-locked]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('can no longer be edited');
    expect(submitButton().disabled).toBe(true);

    page.toggleRemoval('item-1');
    page.submit();
    expect(editSpy).not.toHaveBeenCalled();
  });

  it('picks the country by name and keeps the ISO-2 code in the control', () => {
    getSpy = jest.fn(() =>
      of({ ...orderFixture, shippingAddress: { country: 'FR', city: 'Lyon' } }),
    );
    editSpy = jest.fn();
    configure('order-1');
    const select = fixture.nativeElement.querySelector(
      '[data-testid="country-select"]',
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.textContent).toContain('France (FR)');
    expect(fixture.nativeElement.textContent).not.toContain('ISO 3166 alpha-2');

    select.value = 'FR';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(page.form.controls.shippingAddress.get('country')?.value).toBe('FR');
  });

  it('degrades to the ISO-2 text input when the countries call is refused', () => {
    getSpy = jest.fn(() => of(orderFixture));
    editSpy = jest.fn();
    configure(
      'order-1',
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    expect(fixture.nativeElement.querySelector('[data-testid="country-select"]')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="country-fallback-input"]'),
    ).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Two uppercase letters');
  });

  it('surfaces ApiConflictError on submit as the concurrency banner', () => {
    getSpy = jest.fn(() => of(orderFixture));
    editSpy = jest.fn(() =>
      throwError(() => new ApiConflictError({ code: 'CONFLICT', message: 'stale' })),
    );
    configure('order-1');
    page.submit();
    expect(page.submitError()).toContain('Refresh');
  });

  it('names the order own currency beside the manual discount field', () => {
    // Plan E3.4.3. This field was a raw number box whose only currency mention
    // was an aria-label, so a sighted operator typing a discount on a USD order
    // had nothing on screen telling them which money they were typing.
    loaded();
    const affix = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="input-prefix"]',
    );

    expect(affix?.textContent?.trim()).toBe('USD');
  });
});
