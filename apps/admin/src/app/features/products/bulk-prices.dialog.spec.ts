import { ApiForbiddenError, ApiNotFoundError, ApiServerError } from '@admin-types';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProductsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import {
  BulkPricesDialogComponent,
  moneyScaleValidator,
  type BulkPriceRow,
} from './bulk-prices.dialog';
import { FormControl } from '@angular/forms';
import { provideCurrencyStoreStub } from '../../../testing/currency-store.mock';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';

expect.extend(toHaveNoViolations);

const rows: BulkPriceRow[] = [
  {
    productId: 'p1',
    productName: 'Backpack',
    variantId: 'v1',
    variantSku: 'BAG-01',
    currentPrice: 100,
  },
  {
    productId: 'p2',
    productName: 'Bottle',
    variantId: 'v2',
    variantSku: 'BTL-01',
    currentPrice: 25,
  },
];

describe('BulkPricesDialogComponent', () => {
  let fixture: ComponentFixture<BulkPricesDialogComponent>;
  let cmp: BulkPricesDialogComponent;
  let closeSpy: jest.Mock;
  let bulkUpdatePrices: jest.Mock;

  function configure() {
    closeSpy = jest.fn();
    bulkUpdatePrices = jest.fn(() => of(undefined));
    TestBed.configureTestingModule({
      imports: [BulkPricesDialogComponent],
      providers: [
        { provide: DIALOG_DATA, useValue: { rows } },
        { provide: DialogRef, useValue: { close: closeSpy } },
        { provide: ProductsService, useValue: { bulkUpdatePrices } },
        provideCurrencyStoreStub(),
        provideStoreSettingsStub(),
      ],
    });
    fixture = TestBed.createComponent(BulkPricesDialogComponent);
    cmp = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('pre-populates one price input per row with the current price', () => {
    configure();
    expect(cmp.form.controls.prices.length).toBe(2);
    expect(cmp.form.controls.prices.at(0).value).toBe(100);
    expect(cmp.form.controls.prices.at(1).value).toBe(25);
  });

  it('rejects a negative price via Validators.min(0)', () => {
    configure();
    cmp.priceCtrl(0).setValue(-1);
    expect(cmp.priceCtrl(0).valid).toBe(false);
    expect(cmp.form.invalid).toBe(true);
  });

  it('accepts a millime price and rejects a fourth decimal, at the store scale', () => {
    // This test INVERTS rather than shifts. Under XTS, 9.999 DT is a legal
    // amount an operator is entitled to type, and the previous contract
    // rejected it. The gate moves to the next digit rather than disappearing.
    const validator = moneyScaleValidator(3);
    expect(validator(new FormControl(9.999))).toBeNull();
    expect(validator(new FormControl(9.9999))).toEqual({ moneyScale: { decimalPlaces: 3 } });
    expect(validator(new FormControl(null))).toBeNull();
    expect(validator(new FormControl(''))).toBeNull();
    // The factory really is parameterised, rather than pinned to a new literal.
    expect(moneyScaleValidator(2)(new FormControl(9.999))).toEqual({
      moneyScale: { decimalPlaces: 2 },
    });
  });

  it('disables submit while any price is invalid', () => {
    configure();
    cmp.priceCtrl(0).setValue(-5);
    fixture.detectChanges();
    const submit = fixture.nativeElement.querySelector(
      '[data-testid="bulk-prices-submit"] button',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('submits the full items body and closes with the row count on success', () => {
    configure();
    cmp.priceCtrl(0).setValue(149.99);
    cmp.priceCtrl(1).setValue(30);
    cmp.submit();
    expect(bulkUpdatePrices).toHaveBeenCalledWith({
      items: [
        { variantId: 'v1', price: 149.99 },
        { variantId: 'v2', price: 30 },
      ],
    });
    expect(closeSpy).toHaveBeenCalledWith({ count: 2 });
  });

  it('keeps the dialog open and surfaces an error when the service errors', () => {
    configure();
    bulkUpdatePrices.mockReturnValueOnce(
      throwError(() => new ApiServerError({ code: 'INTERNAL', message: 'boom', status: 500 })),
    );
    cmp.submit();
    fixture.detectChanges();
    expect(closeSpy).not.toHaveBeenCalled();
    expect(cmp.errorMessage()).toMatch(/boom|could not|retry/i);
  });

  it('surfaces ApiForbiddenError as the permission-specific error', () => {
    configure();
    bulkUpdatePrices.mockReturnValueOnce(
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    cmp.submit();
    fixture.detectChanges();
    expect(closeSpy).not.toHaveBeenCalled();
    expect(cmp.errorMessage()).toContain('permission');
  });

  it('surfaces ApiNotFoundError as the product-not-found error', () => {
    configure();
    bulkUpdatePrices.mockReturnValueOnce(
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    cmp.submit();
    fixture.detectChanges();
    expect(closeSpy).not.toHaveBeenCalled();
    expect(cmp.errorMessage()).toBe('Product not found.');
  });

  it('closes with null when cancel is called', () => {
    configure();
    cmp.cancel();
    expect(closeSpy).toHaveBeenCalledWith(null);
  });

  it('is a11y-clean on mount and with an invalid touched row', async () => {
    configure();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();

    cmp.priceCtrl(0).markAsTouched();
    cmp.priceCtrl(0).setValue(-1);
    fixture.detectChanges();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });

  it('names the currency on every price input, not only in the column header', () => {
    // Plan E3.4.3. These were the only money inputs in the admin with no
    // visible unit at all: the code lived in the column header and in an
    // aria-label, so a sighted operator scrolling a long table had nothing
    // beside the field they were typing in.
    configure();
    const affixes = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="input-prefix"]'),
    ).map((el) => el.textContent?.trim());

    expect(affixes).toEqual(['DT', 'DT']);
  });
});
