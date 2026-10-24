import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ApiConflictError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProductsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AttributeDialogComponent, type AttributeDialogData } from './attribute-dialog.component';

expect.extend(toHaveNoViolations);

describe('AttributeDialogComponent', () => {
  let fixture: ComponentFixture<AttributeDialogComponent>;
  let page: AttributeDialogComponent;
  let closeSpy: jest.Mock;
  let createSpy: jest.Mock;
  let updateSpy: jest.Mock;

  const productType = {
    id: 'pt-1',
    name: { default: 'Shoes' },
    code: 'shoes',
  };

  const createData: AttributeDialogData = {
    mode: 'create',
    productTypes: [productType],
  };

  function configure(data: AttributeDialogData = createData) {
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: data },
        { provide: DialogRef, useValue: { close: closeSpy } },
        {
          provide: ProductsService,
          useValue: { createAttribute: createSpy, updateAttribute: updateSpy },
        },
      ],
    });
    fixture = TestBed.createComponent(AttributeDialogComponent);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    closeSpy = jest.fn();
    createSpy = jest.fn();
    updateSpy = jest.fn();
  });

  it('requires a product type + valid code before submit', () => {
    configure();
    page.form.controls.name.setValue({ default: 'Size' });
    page.form.controls.code.setValue('size');
    // productTypeId unset — submit is a no-op.
    page.submit();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects a bad code', () => {
    configure();
    page.form.controls.code.setValue('BAD CODE');
    page.form.controls.code.markAsTouched();
    expect(page.codeError()).toContain('lowercase');
  });

  it('submits a valid create payload with sortOrder', () => {
    const attribute = {
      id: 'a-1',
      productTypeId: productType.id,
      name: { default: 'Size' },
      code: 'size',
      sortOrder: 2,
    };
    createSpy = jest.fn(() => of(attribute));
    configure();
    page.form.controls.productTypeId.setValue(productType.id);
    page.form.controls.name.setValue({ default: 'Size' });
    page.form.controls.code.setValue('size');
    page.form.controls.sortOrder.setValue(2);
    page.submit();
    expect(createSpy).toHaveBeenCalledWith({
      productTypeId: productType.id,
      name: { default: 'Size' },
      code: 'size',
      sortOrder: 2,
    });
    expect(closeSpy).toHaveBeenCalledWith({ kind: 'saved', attribute });
  });

  it('surfaces ApiConflictError from the server', () => {
    createSpy = jest.fn(() =>
      throwError(
        () =>
          new ApiConflictError({
            code: 'CONFLICT',
            message: 'Attribute code must be unique',
          }),
      ),
    );
    configure();
    page.form.controls.productTypeId.setValue(productType.id);
    page.form.controls.name.setValue({ default: 'Size' });
    page.form.controls.code.setValue('size');
    page.submit();
    expect(page.error()).toContain('Attribute code must be unique');
  });

  it('surfaces ApiForbiddenError as the permission-specific error', () => {
    createSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    page.form.controls.productTypeId.setValue(productType.id);
    page.form.controls.name.setValue({ default: 'Size' });
    page.form.controls.code.setValue('size');
    page.submit();
    expect(page.error()).toContain('permission');
  });

  it('surfaces ApiNotFoundError as the attribute-not-found error', () => {
    createSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    page.form.controls.productTypeId.setValue(productType.id);
    page.form.controls.name.setValue({ default: 'Size' });
    page.form.controls.code.setValue('size');
    page.submit();
    expect(page.error()).toBe('Attribute not found.');
  });

  it('edit mode disables productTypeId + pre-populates', () => {
    configure({
      mode: 'edit',
      productTypes: [productType],
      attribute: {
        id: 'a-1',
        productTypeId: productType.id,
        name: { default: 'Size' },
        code: 'size',
        sortOrder: 1,
      },
    });
    expect(page.form.controls.productTypeId.disabled).toBe(true);
    expect(page.form.controls.code.value).toBe('size');
    expect(page.form.controls.sortOrder.value).toBe(1);
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
