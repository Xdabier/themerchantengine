import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ApiConflictError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProductsService, type Variant } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { VariantDialogComponent, type VariantDialogData } from './variant-dialog.component';
import { provideCurrencyStoreStub } from '../../../testing/currency-store.mock';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';
import type { MoneySymbolPosition } from '../../core/stores/store-settings.store';

expect.extend(toHaveNoViolations);

describe('VariantDialogComponent', () => {
  let fixture: ComponentFixture<VariantDialogComponent>;
  let component: VariantDialogComponent;
  let createSpy: jest.Mock;
  let updateSpy: jest.Mock;
  let deleteSpy: jest.Mock;
  let closeSpy: jest.Mock;

  const baseVariant: Variant = {
    id: 'v-1',
    productId: 'prod-1',
    sku: 'SKU-1',
    price: 100,
    weight: 0.5,
    barcode: '123',
    isActive: true,
    isDefault: true,
  } as Variant;

  function configure(variant: Variant | null, symbolPosition: MoneySymbolPosition = 'before') {
    const data: VariantDialogData = { productId: 'prod-1', variant };
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: data },
        provideCurrencyStoreStub(),
        provideStoreSettingsStub(undefined, undefined, undefined, [], symbolPosition),
        {
          provide: DialogRef,
          useValue: { close: closeSpy },
        },
        {
          provide: ProductsService,
          useValue: {
            createVariant: createSpy,
            updateVariant: updateSpy,
            deleteVariant: deleteSpy,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(VariantDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    createSpy = jest.fn(() => of({ ...baseVariant, id: 'v-new' }));
    updateSpy = jest.fn((_pid: string, _vid: string, body: Partial<Variant>) =>
      of({ ...baseVariant, ...body }),
    );
    deleteSpy = jest.fn(() => of(undefined));
    closeSpy = jest.fn();
  });

  it('seeds the form from an existing variant', () => {
    configure(baseVariant);
    expect(component.form.controls.sku.value).toBe('SKU-1');
    expect(component.form.controls.price.value).toBe(100);
  });

  it('create flow POSTs createVariant + closes with kind=saved', () => {
    configure(null);
    component.form.setValue({
      sku: 'NEW',
      price: 50,
      compareAtPrice: null,
      costPrice: null,
      weight: null,
      barcode: '',
      isActive: true,
      isDefault: false,
    });
    component.save();
    expect(createSpy).toHaveBeenCalledWith(
      'prod-1',
      expect.objectContaining({ sku: 'NEW', price: 50 }),
    );
    expect(closeSpy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'saved' }));
  });

  it('edit flow PATCHes updateVariant with the dirty body', () => {
    configure(baseVariant);
    component.form.controls.price.setValue(999);
    component.save();
    expect(updateSpy).toHaveBeenCalledWith(
      'prod-1',
      'v-1',
      expect.objectContaining({ price: 999 }),
    );
  });

  it('rejects save with an invalid price', () => {
    configure(baseVariant);
    component.form.controls.price.setValue(-1 as never);
    component.form.controls.price.markAsTouched();
    component.save();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(component.priceError()).toMatch(/positive/);
  });

  it('delete calls deleteVariant + closes with kind=deleted', () => {
    configure(baseVariant);
    component.delete();
    expect(deleteSpy).toHaveBeenCalledWith('prod-1', 'v-1');
    expect(closeSpy).toHaveBeenCalledWith({ kind: 'deleted', variantId: 'v-1' });
  });

  it('maps ApiConflictError on delete to the last-variant message', () => {
    deleteSpy = jest.fn(() =>
      throwError(() => new ApiConflictError({ code: 'CONFLICT', message: 'last' })),
    );
    configure(baseVariant);
    component.delete();
    expect(component.error()).toContain('Last active variant');
  });

  it('maps ApiForbiddenError on save to a permission-safe message', () => {
    updateSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure(baseVariant);
    component.form.controls.sku.setValue('Other');
    component.save();
    expect(component.error()).toContain('permission');
  });

  it('maps ApiNotFoundError on save to the variant-not-found error', () => {
    updateSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure(baseVariant);
    component.form.controls.sku.setValue('Other');
    component.save();
    expect(component.error()).toBe('Variant not found.');
  });

  it('cancel closes with null', () => {
    configure(baseVariant);
    component.cancel();
    expect(closeSpy).toHaveBeenCalledWith(null);
  });

  it('has no axe violations', async () => {
    configure(baseVariant);
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
  // A4: the money fields were bare number boxes with no unit anywhere on the
  // screen, so an operator could not tell what currency they were typing.
  describe('money fields name their unit', () => {
    it('writes the symbol before the number when the store says before', () => {
      configure(baseVariant, 'before');
      const root = fixture.nativeElement as HTMLElement;

      const prefixes = Array.from(root.querySelectorAll('[data-testid="input-prefix"]')).map((el) =>
        el.textContent?.trim(),
      );
      expect(prefixes).toEqual(['DT', 'DT', 'DT']);
      expect(root.querySelectorAll('[data-testid="input-suffix"]')).toHaveLength(0);
    });

    it('writes the symbol after the number when the store says after', () => {
      // The half that had no reader at all before E3.4.3: every money field
      // suffixed the ISO code whatever `money.symbolPosition` said.
      configure(baseVariant, 'after');
      const root = fixture.nativeElement as HTMLElement;

      const suffixes = Array.from(root.querySelectorAll('[data-testid="input-suffix"]')).map((el) =>
        el.textContent?.trim(),
      );
      expect(suffixes).toEqual(['DT', 'DT', 'DT']);
      expect(root.querySelectorAll('[data-testid="input-prefix"]')).toHaveLength(0);
    });

    it('repeats the code in the hints, because the suffix is aria-hidden', () => {
      configure(baseVariant);
      const root = fixture.nativeElement as HTMLElement;
      expect(root.textContent).toContain('Amount in XTS.');
    });
  });
});
