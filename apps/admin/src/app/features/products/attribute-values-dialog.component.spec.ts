import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ApiConflictError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProductsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import {
  AttributeValuesDialogComponent,
  type AttributeValuesDialogData,
} from './attribute-values-dialog.component';

expect.extend(toHaveNoViolations);

describe('AttributeValuesDialogComponent', () => {
  let fixture: ComponentFixture<AttributeValuesDialogComponent>;
  let page: AttributeValuesDialogComponent;
  let closeSpy: jest.Mock;
  let createValueSpy: jest.Mock;
  let deleteValueSpy: jest.Mock;

  const attribute = {
    id: 'a-1',
    productTypeId: 'pt-1',
    name: { default: 'Size' },
    code: 'size',
    values: [
      { id: 'v-1', value: { default: 'S' }, code: 'sz-s', sortOrder: 0 },
      { id: 'v-2', value: { default: 'M' }, code: 'sz-m', sortOrder: 1 },
    ],
  };

  function configure(data: AttributeValuesDialogData = { attribute, canMutate: true }) {
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: data },
        { provide: DialogRef, useValue: { close: closeSpy } },
        {
          provide: ProductsService,
          useValue: {
            createAttributeValue: createValueSpy,
            deleteAttributeValue: deleteValueSpy,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(AttributeValuesDialogComponent);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    closeSpy = jest.fn();
    createValueSpy = jest.fn();
    deleteValueSpy = jest.fn();
  });

  it('renders existing values sorted by sortOrder', () => {
    configure();
    expect(page.values()).toHaveLength(2);
    expect(page.values()[0].code).toBe('sz-s');
  });

  it('addValue POSTs through the service and merges updated values list', () => {
    const updated = {
      ...attribute,
      values: [
        ...attribute.values,
        { id: 'v-3', value: { default: 'L' }, code: 'sz-l', sortOrder: 2 },
      ],
    };
    createValueSpy = jest.fn(() => of(updated));
    configure();
    page.form.controls.value.setValue({ default: 'L' });
    page.form.controls.code.setValue('sz-l');
    page.addValue();
    expect(createValueSpy).toHaveBeenCalledWith('a-1', {
      value: { default: 'L' },
      code: 'sz-l',
    });
    expect(page.values()).toHaveLength(3);
  });

  it('deleteValue removes the row on success', () => {
    deleteValueSpy = jest.fn(() => of(undefined));
    configure();
    page.deleteValue(attribute.values[0]);
    expect(deleteValueSpy).toHaveBeenCalledWith('a-1', 'v-1');
    expect(page.values()).toHaveLength(1);
  });

  it('surfaces ApiConflictError from the server on delete', () => {
    deleteValueSpy = jest.fn(() =>
      throwError(
        () => new ApiConflictError({ code: 'CONFLICT', message: 'Variants use this value' }),
      ),
    );
    configure();
    page.deleteValue(attribute.values[0]);
    expect(page.error()).toContain('Variants use this value');
  });

  it('surfaces ApiForbiddenError as the permission-specific error', () => {
    deleteValueSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    page.deleteValue(attribute.values[0]);
    expect(page.error()).toContain('permission');
  });

  it('surfaces ApiNotFoundError as the attribute-value-not-found error', () => {
    deleteValueSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    page.deleteValue(attribute.values[0]);
    expect(page.error()).toBe('Attribute value not found.');
  });

  it('close fires a changed result when mutations happened', () => {
    deleteValueSpy = jest.fn(() => of(undefined));
    configure();
    page.deleteValue(attribute.values[0]);
    page.close();
    expect(closeSpy).toHaveBeenCalledWith({ kind: 'changed' });
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
