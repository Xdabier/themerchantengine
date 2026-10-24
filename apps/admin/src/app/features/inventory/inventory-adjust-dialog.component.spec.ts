import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InventoryService } from '@admin-services';
import { ApiForbiddenError, ApiNotFoundError, ApiValidationError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { InventoryAdjustDialogComponent } from './inventory-adjust-dialog.component';

expect.extend(toHaveNoViolations);

describe('InventoryAdjustDialogComponent', () => {
  let fixture: ComponentFixture<InventoryAdjustDialogComponent>;
  let adjustSpy: jest.Mock;
  let listLocationsSpy: jest.Mock;
  const close = jest.fn();

  function configure(data: unknown = { variantId: 'var-1', locationId: 'loc-1' }) {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: InventoryService,
          useValue: { adjustInventory: adjustSpy, listLocations: listLocationsSpy },
        },
        { provide: DialogRef, useValue: { close } },
        { provide: DIALOG_DATA, useValue: data },
      ],
    });
    fixture = TestBed.createComponent(InventoryAdjustDialogComponent);
    fixture.detectChanges();
  }

  beforeEach(() => {
    adjustSpy = jest.fn(() => of(undefined));
    listLocationsSpy = jest.fn(() =>
      of({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }),
    );
    close.mockReset();
  });

  it('mounts with the pre-filled variant + location from dialog data', () => {
    configure();
    expect(fixture.componentInstance.form.controls.variantId.value).toBe('var-1');
    expect(fixture.componentInstance.form.controls.locationId.value).toBe('loc-1');
  });

  it('surfaces a forbidden copy on ApiForbiddenError', () => {
    adjustSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    fixture.componentInstance.form.patchValue({ variantId: 'v', locationId: 'l', quantity: 1 });
    fixture.componentInstance.submit();
    expect(fixture.componentInstance.error()).toContain('permission');
  });

  it('surfaces the not-found copy on ApiNotFoundError', () => {
    adjustSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    fixture.componentInstance.form.patchValue({ variantId: 'v', locationId: 'l', quantity: 1 });
    fixture.componentInstance.submit();
    expect(fixture.componentInstance.error()).toBe('Inventory record not found.');
  });

  it('surfaces validation errors verbatim', () => {
    adjustSpy = jest.fn(() =>
      throwError(() => new ApiValidationError({ code: 'VALIDATION', message: 'quantity invalid' })),
    );
    configure();
    fixture.componentInstance.form.patchValue({ variantId: 'v', locationId: 'l', quantity: 1 });
    fixture.componentInstance.submit();
    expect(fixture.componentInstance.error()).toBe('quantity invalid');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
