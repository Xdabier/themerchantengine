import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InventoryService } from '@admin-services';
import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { InventoryTransferDialogComponent } from './inventory-transfer-dialog.component';

expect.extend(toHaveNoViolations);

describe('InventoryTransferDialogComponent', () => {
  let fixture: ComponentFixture<InventoryTransferDialogComponent>;
  let transferSpy: jest.Mock;
  let listLocationsSpy: jest.Mock;
  const close = jest.fn();

  function configure(data: unknown = { variantId: 'var-1', fromLocationId: 'loc-1' }) {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: InventoryService,
          useValue: { transferInventory: transferSpy, listLocations: listLocationsSpy },
        },
        { provide: DialogRef, useValue: { close } },
        { provide: DIALOG_DATA, useValue: data },
      ],
    });
    fixture = TestBed.createComponent(InventoryTransferDialogComponent);
    fixture.detectChanges();
  }

  beforeEach(() => {
    transferSpy = jest.fn(() => of(undefined));
    listLocationsSpy = jest.fn(() =>
      of({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }),
    );
    close.mockReset();
  });

  it('reflects the same-location cross-field error live', () => {
    configure();
    expect(fixture.componentInstance.sameLocationError()).toBe(false);

    fixture.componentInstance.form.patchValue({ fromLocationId: 'loc-1', toLocationId: 'loc-1' });
    fixture.detectChanges();

    expect(fixture.componentInstance.sameLocationError()).toBe(true);
  });

  it('mounts with the pre-filled variant + source location', () => {
    configure();
    expect(fixture.componentInstance.form.controls.variantId.value).toBe('var-1');
    expect(fixture.componentInstance.form.controls.fromLocationId.value).toBe('loc-1');
  });

  it('surfaces a forbidden copy on ApiForbiddenError', () => {
    transferSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    fixture.componentInstance.form.patchValue({
      variantId: 'v',
      fromLocationId: 'a',
      toLocationId: 'b',
      quantity: 1,
    });
    fixture.componentInstance.submit();
    expect(fixture.componentInstance.error()).toContain('permission');
  });

  it('surfaces the not-found copy on ApiNotFoundError', () => {
    transferSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    fixture.componentInstance.form.patchValue({
      variantId: 'v',
      fromLocationId: 'a',
      toLocationId: 'b',
      quantity: 1,
    });
    fixture.componentInstance.submit();
    expect(fixture.componentInstance.error()).toBe('Location not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
