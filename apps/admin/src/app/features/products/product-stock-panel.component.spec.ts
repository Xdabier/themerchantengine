import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InventoryService, ProductsService } from '@admin-services';
import { ApiConflictError, ApiError, ApiForbiddenError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ProductStockPanelComponent } from './product-stock-panel.component';

expect.extend(toHaveNoViolations);

const LOC_A = { id: 'loc-a', name: 'Lyon', code: 'LYN', isActive: true };
const LOC_B = { id: 'loc-b', name: 'Sfax', code: 'SFX', isActive: true };

function stock(overrides: Record<string, unknown> = {}) {
  return {
    lowStockThreshold: 5,
    locations: [LOC_A],
    variants: [
      {
        variantId: 'v-1',
        sku: 'SKU-1',
        isDefault: true,
        totals: { onHand: 20, reserved: 2, available: 18 },
        status: 'IN_STOCK' as const,
        levels: [
          {
            stockLevelId: 'sl-1',
            locationId: 'loc-a',
            location: LOC_A,
            onHand: 20,
            reserved: 2,
            available: 18,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('ProductStockPanelComponent', () => {
  let fixture: ComponentFixture<ProductStockPanelComponent>;
  let getStockSpy: jest.Mock;
  let adjustSpy: jest.Mock;
  let closeSpy: jest.Mock;

  function configure() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        // The no-locations branch renders a routerLink.
        provideRouter([{ path: '**', children: [] }]),
        { provide: ProductsService, useValue: { getProductStock: getStockSpy } },
        { provide: InventoryService, useValue: { adjustInventory: adjustSpy } },
        { provide: DialogRef, useValue: { close: closeSpy } },
        {
          provide: DIALOG_DATA,
          useValue: { productId: 'prod-1', variantId: 'v-1', sku: 'SKU-1' },
        },
      ],
    });
    fixture = TestBed.createComponent(ProductStockPanelComponent);
    fixture.detectChanges();
  }

  function el<T extends HTMLElement>(selector: string): T {
    return fixture.nativeElement.querySelector(selector) as T;
  }
  function setTarget(locationId: string, value: number): void {
    const input = el<HTMLInputElement>(`[data-testid="product-stock-target-${locationId}"]`);
    input.value = String(value);
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
  function submit(): void {
    el<HTMLFormElement>('form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  beforeEach(() => {
    getStockSpy = jest.fn(() => of(stock()));
    adjustSpy = jest.fn(() => of(undefined));
    closeSpy = jest.fn();
  });

  it('seeds the target with what is currently on hand', () => {
    configure();
    expect(el<HTMLInputElement>('[data-testid="product-stock-target-loc-a"]').value).toBe('20');
  });

  /**
   * The whole reason for SET mode. A client-computed delta from two operators
   * both reading 20 and both setting 25 would send +5 twice and land at 30.
   */
  it('sends the target and the value it showed, not a delta', () => {
    configure();
    setTarget('loc-a', 25);
    submit();
    expect(adjustSpy).toHaveBeenCalledWith(
      expect.objectContaining({ setTo: 25, expectedOnHand: 20, locationId: 'loc-a' }),
      expect.any(String),
    );
    expect(adjustSpy.mock.calls[0][0].quantity).toBeUndefined();
  });

  it('does not write a location whose target was not changed', () => {
    getStockSpy = jest.fn(() => of(stock({ locations: [LOC_A, LOC_B] })));
    configure();
    setTarget('loc-a', 25);
    submit();
    expect(adjustSpy).toHaveBeenCalledTimes(1);
    expect(adjustSpy.mock.calls[0][0].locationId).toBe('loc-a');
  });

  it('offers a line for an active location that has no stock row yet', () => {
    getStockSpy = jest.fn(() => of(stock({ locations: [LOC_A, LOC_B] })));
    configure();
    expect(el('[data-testid="product-stock-line-loc-b"]')).not.toBeNull();
    expect(el<HTMLInputElement>('[data-testid="product-stock-target-loc-b"]').value).toBe('0');
  });

  it('creating the first row sends expectedOnHand 0', () => {
    getStockSpy = jest.fn(() => of(stock({ locations: [LOC_A, LOC_B] })));
    configure();
    setTarget('loc-b', 7);
    submit();
    expect(adjustSpy).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: 'loc-b', setTo: 7, expectedOnHand: 0 }),
      expect.any(String),
    );
  });

  it('blocks entirely when no location exists rather than inviting a write', () => {
    getStockSpy = jest.fn(() => of(stock({ locations: [], variants: [] })));
    configure();
    expect(el('[data-testid="product-stock-no-locations"]')).not.toBeNull();
    expect(el('form')).toBeNull();
  });

  /**
   * An inactive location holding stock must stay visible, or those units simply
   * disappear from the operator's view of the variant.
   */
  it('keeps an inactive location that still holds stock', () => {
    const withStranded = stock({ locations: [LOC_A] });
    withStranded.variants[0].levels.push({
      stockLevelId: 'sl-2',
      locationId: 'loc-old',
      location: { id: 'loc-old', name: 'Old depot', code: 'OLD', isActive: false },
      onHand: 4,
      reserved: 0,
      available: 4,
    });
    getStockSpy = jest.fn(() => of(withStranded));
    configure();
    const line = el('[data-testid="product-stock-line-loc-old"]');
    expect(line).not.toBeNull();
    expect(line.textContent).toContain('inactive');
  });

  it('a losing compare-and-set reports what is actually there and re-reads', () => {
    adjustSpy = jest.fn(() =>
      throwError(
        () =>
          new ApiConflictError({
            code: 'INVENTORY_STOCK_CONFLICT',
            message: 'changed',
            details: { currentOnHand: 31 },
          }),
      ),
    );
    configure();
    setTarget('loc-a', 25);
    submit();
    expect(el('[data-testid="product-stock-error"]').textContent).toContain('31');
    // Re-read so the field shows the moved value the operator must retype against.
    expect(getStockSpy).toHaveBeenCalledTimes(2);
  });

  it('explains a below-reserved refusal in the operator’s terms', () => {
    adjustSpy = jest.fn(() =>
      throwError(
        () =>
          new ApiError({ code: 'INVENTORY_SET_BELOW_RESERVED', message: 'reserved', status: 400 }),
      ),
    );
    configure();
    setTarget('loc-a', 1);
    submit();
    expect(el('[data-testid="product-stock-error"]').textContent).toContain('reserved');
  });

  it('maps a forbidden write to a permission message', () => {
    adjustSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    setTarget('loc-a', 25);
    submit();
    expect(el('[data-testid="product-stock-error"]').textContent).toContain('permission');
  });

  /**
   * The double-apply defect, at the surface that would otherwise inherit it: a
   * key minted per call makes two clicks two distinct requests, so both apply.
   */
  it('reuses one idempotency key for the same target, so a double submit replays', () => {
    configure();
    setTarget('loc-a', 25);
    submit();
    submit();
    const keys = adjustSpy.mock.calls.map((c) => c[1]);
    expect(new Set(keys).size).toBe(1);
  });

  it('closes with true after a successful save so the caller can refresh', () => {
    configure();
    setTarget('loc-a', 25);
    submit();
    expect(closeSpy).toHaveBeenCalledWith(true);
  });

  it('surfaces a failed initial read instead of rendering an empty panel', () => {
    getStockSpy = jest.fn(() => throwError(() => new Error('boom')));
    configure();
    expect(el('[data-testid="product-stock-error"]')).not.toBeNull();
  });

  it('has no axe violations', async () => {
    configure();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });
});
