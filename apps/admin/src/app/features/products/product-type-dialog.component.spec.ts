import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ApiConflictError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProductsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import {
  ProductTypeDialogComponent,
  type ProductTypeDialogData,
} from './product-type-dialog.component';

expect.extend(toHaveNoViolations);

describe('ProductTypeDialogComponent', () => {
  let fixture: ComponentFixture<ProductTypeDialogComponent>;
  let page: ProductTypeDialogComponent;
  let closeSpy: jest.Mock;
  let createSpy: jest.Mock;
  let updateSpy: jest.Mock;

  const createData: ProductTypeDialogData = {
    mode: 'create',
    taxClasses: [],
  };

  function configure(data: ProductTypeDialogData = createData) {
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: data },
        { provide: DialogRef, useValue: { close: closeSpy } },
        {
          provide: ProductsService,
          useValue: { createProductType: createSpy, updateProductType: updateSpy },
        },
      ],
    });
    fixture = TestBed.createComponent(ProductTypeDialogComponent);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    closeSpy = jest.fn();
    createSpy = jest.fn();
    updateSpy = jest.fn();
  });

  it('rejects a code with uppercase letters', () => {
    configure();
    page.form.controls.code.setValue('Bad Code!');
    page.form.controls.code.markAsTouched();
    expect(page.codeError()).toContain('lowercase');
  });

  it('rejects a missing default name', () => {
    configure();
    page.form.controls.code.setValue('shoes');
    page.submit();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('submits a valid create payload and closes with saved', () => {
    const fake = {
      id: 'pt-1',
      name: { default: 'Shoes' },
      code: 'shoes',
      taxClassId: null,
    };
    createSpy = jest.fn(() => of(fake));
    configure();
    page.form.controls.name.setValue({ default: 'Shoes' });
    page.form.controls.code.setValue('shoes');
    page.submit();
    expect(createSpy).toHaveBeenCalledWith({ name: { default: 'Shoes' }, code: 'shoes' });
    expect(closeSpy).toHaveBeenCalledWith({ kind: 'saved', productType: fake });
  });

  it('surfaces ApiConflictError from the server', () => {
    createSpy = jest.fn(() =>
      throwError(() => new ApiConflictError({ code: 'CONFLICT', message: 'Code already in use' })),
    );
    configure();
    page.form.controls.name.setValue({ default: 'Shoes' });
    page.form.controls.code.setValue('shoes');
    page.submit();
    expect(page.error()).toContain('Code already in use');
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('surfaces ApiForbiddenError as the permission-specific error', () => {
    createSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    page.form.controls.name.setValue({ default: 'Shoes' });
    page.form.controls.code.setValue('shoes');
    page.submit();
    expect(page.error()).toContain('permission');
  });

  it('surfaces ApiNotFoundError as the product-type-not-found error', () => {
    createSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    page.form.controls.name.setValue({ default: 'Shoes' });
    page.form.controls.code.setValue('shoes');
    page.submit();
    expect(page.error()).toBe('Product type not found.');
  });

  it('edit mode pre-populates the form from the provided product type', () => {
    configure({
      mode: 'edit',
      taxClasses: [],
      productType: {
        id: 'pt-1',
        name: { default: 'Shoes' },
        code: 'shoes',
        taxClassId: null,
      },
    });
    expect(page.form.controls.name.value).toEqual({ default: 'Shoes' });
    expect(page.form.controls.code.value).toBe('shoes');
  });

  it('cancel closes with null', () => {
    configure();
    page.cancel();
    expect(closeSpy).toHaveBeenCalledWith(null);
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
