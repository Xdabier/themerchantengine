import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OrdersService } from '@admin-services';
import { ApiConflictError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { OrderShipmentPanelComponent } from './order-shipment-panel.component';

expect.extend(toHaveNoViolations);

const orderFixture = {
  id: 'order-1',
  status: 'CONFIRMED' as const,
  createdAt: '2026-04-01T10:00:00.000Z',
  updatedAt: '2026-04-01T10:00:00.000Z',
  items: [
    { id: 'item-1', sku: 'SKU-A', quantity: 2 },
    { id: 'item-2', sku: 'SKU-B', quantity: 1 },
  ],
  shipments: [{ id: 'ship-1', carrier: 'DHL', trackingNumber: 'TRK-1', status: 'PROCESSING' }],
};

/**
 * Object-shaped `productName` on purpose: admin reads send
 * `X-Resolve-Locale: false`, so string-only fixtures hide `[object Object]`.
 */
const richOrderFixture = {
  ...orderFixture,
  id: 'order-4',
  items: [
    {
      id: 'item-1',
      sku: 'SHOE-URB-42',
      productName: { default: 'Miroir dentaire', fr: 'Miroir dentaire', en: 'Dental mirror' },
      variantLabel: 'Size 42',
      quantity: 2,
    },
  ],
  shipments: [
    {
      id: 'ship-4-2',
      carrier: 'DHL',
      trackingNumber: 'TRK-2',
      status: 'DELIVERED',
      createdAt: '2026-04-02T10:00:00.000Z',
    },
    {
      id: 'ship-4-1',
      carrier: 'DHL',
      trackingNumber: 'TRK-1',
      status: 'PROCESSING',
      createdAt: '2026-04-01T10:00:00.000Z',
    },
  ],
};

describe('OrderShipmentPanelComponent', () => {
  let fixture: ComponentFixture<OrderShipmentPanelComponent>;
  let createShipmentSpy: jest.Mock;
  let updateShipmentSpy: jest.Mock;

  function configure(order: unknown = orderFixture) {
    TestBed.configureTestingModule({
      providers: [
        { provide: Dialog, useValue: { open: jest.fn() } },
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: OrdersService,
          useValue: { createShipment: createShipmentSpy, updateShipment: updateShipmentSpy },
        },
      ],
    });
    fixture = TestBed.createComponent(OrderShipmentPanelComponent);
    fixture.componentRef.setInput('order', order);
    fixture.detectChanges();
  }

  beforeEach(() => {
    createShipmentSpy = jest.fn(() => of({ id: 'ship-2' }));
    updateShipmentSpy = jest.fn(() => of({ id: 'ship-1' }));
  });

  it('mounts and renders both the items table and existing shipment list', () => {
    configure();
    expect(
      fixture.nativeElement.querySelector('[data-testid="order-shipment-panel"]'),
    ).toBeTruthy();
    expect(fixture.componentInstance.existing().length).toBe(1);
    expect(fixture.componentInstance.items().length).toBe(2);
  });

  // ── QA C4 / F10: the select must show the status it claims to hold ─────────

  it('initialises each shipment select to that shipment real status', () => {
    configure(richOrderFixture);
    const selects: HTMLSelectElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('select[data-testid^="shipment-advance-"]'),
    );
    // `[value]` alone was applied before the options existed, so the browser
    // fell back to the first option and every row read PROCESSING.
    expect(selects.map((s) => s.getAttribute('data-testid'))).toEqual([
      'shipment-advance-ship-4-1',
      'shipment-advance-ship-4-2',
    ]);
    expect(selects.map((s) => s.value)).toEqual(['PROCESSING', 'DELIVERED']);
  });

  it('does not rewrite a shipment with the status it already has', () => {
    configure(richOrderFixture);
    const select = fixture.nativeElement.querySelector(
      'select[data-testid="shipment-advance-ship-4-2"]',
    ) as HTMLSelectElement;
    select.value = 'DELIVERED';
    select.dispatchEvent(new Event('change'));
    expect(updateShipmentSpy).not.toHaveBeenCalled();

    select.value = 'SHIPPED';
    select.dispatchEvent(new Event('change'));
    expect(updateShipmentSpy).toHaveBeenCalledWith('order-4', 'ship-4-2', { status: 'SHIPPED' });
  });

  it('surfaces a forbidden copy on ApiForbiddenError when creating a shipment', () => {
    createShipmentSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    // Check one item via the form array to make createShipment proceed.
    const arr = (
      fixture.componentInstance as unknown as {
        form: { controls: { items: { controls: { setValue: (v: unknown) => void }[] } } };
      }
    ).form.controls.items.controls;
    arr[0].setValue({ id: 'item-1', checked: true, quantity: 2 });
    fixture.componentInstance.createShipment();
    expect(fixture.componentInstance.error()).toContain('permission');
  });

  it('surfaces the not-found copy on ApiNotFoundError when advancing a shipment', () => {
    updateShipmentSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    const evt = { target: { value: 'SHIPPED' } } as unknown as Event;
    fixture.componentInstance.advanceShipment(fixture.componentInstance.existing()[0], evt);
    expect(fixture.componentInstance.error()).toBe('Shipment not found.');
  });

  it('surfaces conflict copy on ApiConflictError', () => {
    updateShipmentSpy = jest.fn(() =>
      throwError(() => new ApiConflictError({ code: 'CONFLICT', message: 'bad state' })),
    );
    configure();
    const evt = { target: { value: 'DELIVERED' } } as unknown as Event;
    fixture.componentInstance.advanceShipment(fixture.componentInstance.existing()[0], evt);
    expect(fixture.componentInstance.error()).toBe('Shipment state rejected by the server.');
  });

  it('labels shipments positionally by creation order, never by internal id', () => {
    configure(richOrderFixture);
    const list = fixture.nativeElement.querySelector(
      '[data-testid="shipment-list"]',
    ) as HTMLElement;
    expect(list.textContent).toContain('Shipment 1');
    expect(list.textContent).toContain('Shipment 2');
    expect(list.textContent).not.toContain('ship-4-1');
    expect(list.textContent).not.toContain('ship-4-2');
    // Oldest shipment first, so the ordinal is stable across reloads.
    expect(fixture.componentInstance.existing().map((s) => s.id)).toEqual(['ship-4-1', 'ship-4-2']);
  });

  it('keeps the raw shipment id on the title attribute and the testids', () => {
    configure(richOrderFixture);
    const row = fixture.nativeElement.querySelector('[title="ship-4-1"]');
    expect(row).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('[data-testid="shipment-advance-ship-4-1"]'),
    ).toBeTruthy();
  });

  it('renders shipment status as a label in the badge, the options and the aria-label', () => {
    configure(richOrderFixture);
    const list = fixture.nativeElement.querySelector(
      '[data-testid="shipment-list"]',
    ) as HTMLElement;
    expect(list.textContent).toContain('Processing');
    expect(list.textContent).toContain('Delivered');
    expect(list.textContent).not.toContain('PROCESSING');
    expect(list.textContent).not.toContain('DELIVERED');

    const select = fixture.nativeElement.querySelector(
      '[data-testid="shipment-advance-ship-4-1"]',
    ) as HTMLSelectElement;
    expect(select.getAttribute('aria-label')).toBe('Update Shipment 1 status');
    expect([...select.options].map((o) => o.textContent?.trim())).toEqual([
      'Processing',
      'Shipped',
      'Delivered',
    ]);
    // The raw enum stays on the option value, which is what the API takes.
    expect([...select.options].map((o) => o.value)).toEqual(['PROCESSING', 'SHIPPED', 'DELIVERED']);
  });

  it('names the items to ship, with the SKU as secondary text', () => {
    configure(richOrderFixture);
    const label = fixture.nativeElement.querySelector('[data-testid="shipment-item-check-item-1"]')
      .parentElement as HTMLElement;
    expect(label.textContent).toContain('Miroir dentaire');
    expect(label.textContent).toContain('Size 42');
    expect(label.textContent).toContain('SHOE-URB-42');
    expect(label.textContent).not.toContain('[object Object]');

    const qty = fixture.nativeElement.querySelector('[data-testid="shipment-item-qty-item-1"]');
    expect(qty.getAttribute('aria-label')).toContain('Miroir dentaire');
  });

  it('falls back to the SKU then the id when a line carries no product name', () => {
    configure();
    const label = fixture.nativeElement.querySelector('[data-testid="shipment-item-check-item-1"]')
      .parentElement as HTMLElement;
    expect(label.textContent).toContain('SKU-A');
    expect(label.textContent).not.toContain('item-1');
  });

  // == Plan M phase M1: the panel reads the order status (finding AD4) ========

  const closedOrderFixture = {
    ...orderFixture,
    id: 'order-closed',
    status: 'CANCELLED' as const,
    shipments: [
      {
        id: 'ship-c-1',
        carrier: 'DHL',
        trackingNumber: 'TRK-C',
        status: 'CANCELLED',
        createdAt: '2026-04-01T10:00:00.000Z',
      },
    ],
  };

  it.each(['CANCELLED', 'COMPLETED', 'RETURNED'])(
    'freezes the whole panel on a %s order',
    (status) => {
      // The API refuses both writes with ORDER_SHIPMENT_ORDER_CLOSED, so
      // offering the controls only produces a 409 the operator has to read.
      configure({ ...closedOrderFixture, status });
      const root = fixture.nativeElement as HTMLElement;

      expect(root.querySelector('[data-testid="shipment-closed-notice"]')).toBeTruthy();
      expect(root.querySelector('select[data-testid^="shipment-advance-"]')).toBeNull();
      expect(root.querySelector('[data-testid="shipment-create-submit"]')).toBeNull();
    },
  );

  it('still lists the shipments of a closed order', () => {
    // Frozen, not hidden: the operator still needs to see what was shipped.
    configure(closedOrderFixture);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="shipment-list"]')).toBeTruthy();
    expect(root.textContent).toContain('Cancelled');
  });

  it('keeps the panel editable on an open order', () => {
    configure(orderFixture);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="shipment-closed-notice"]')).toBeNull();
    expect(root.querySelector('select[data-testid^="shipment-advance-"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="shipment-create-submit"]')).toBeTruthy();
  });

  it('drops the status select on a cancelled shipment inside an open order', () => {
    // A cancelled shipment is terminal even while the order lives on: it was
    // cancelled by a cascade that a later admin cancel could repeat.
    configure({
      ...orderFixture,
      id: 'order-mixed',
      status: 'PROCESSING',
      shipments: [
        {
          id: 'ship-m-1',
          carrier: 'DHL',
          trackingNumber: 'TRK-M1',
          status: 'CANCELLED',
          createdAt: '2026-04-01T10:00:00.000Z',
        },
        {
          id: 'ship-m-2',
          carrier: 'DHL',
          trackingNumber: 'TRK-M2',
          status: 'PROCESSING',
          createdAt: '2026-04-02T10:00:00.000Z',
        },
      ],
    });
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('select[data-testid="shipment-advance-ship-m-1"]')).toBeNull();
    expect(root.querySelector('select[data-testid="shipment-advance-ship-m-2"]')).toBeTruthy();
  });

  it('never offers CANCELLED as a status an admin can pick', () => {
    // It is set by the order cancel cascade only, and the API refuses to move a
    // row back out of it.
    configure(orderFixture);
    const options: HTMLOptionElement[] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        'select[data-testid^="shipment-advance-"] option',
      ),
    );
    expect(options.map((o) => o.value)).not.toContain('CANCELLED');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
