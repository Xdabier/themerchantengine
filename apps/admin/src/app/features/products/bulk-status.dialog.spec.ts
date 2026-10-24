import { ApiForbiddenError, ApiNotFoundError, ApiServerError } from '@admin-types';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProductsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { BulkStatusDialogComponent } from './bulk-status.dialog';

expect.extend(toHaveNoViolations);

describe('BulkStatusDialogComponent', () => {
  let fixture: ComponentFixture<BulkStatusDialogComponent>;
  let cmp: BulkStatusDialogComponent;
  let closeSpy: jest.Mock;
  let bulkUpdateStatus: jest.Mock;

  function configure(productIds = ['p1', 'p2']) {
    closeSpy = jest.fn();
    bulkUpdateStatus = jest.fn(() => of(undefined));
    TestBed.configureTestingModule({
      imports: [BulkStatusDialogComponent],
      providers: [
        { provide: DIALOG_DATA, useValue: { productIds } },
        { provide: DialogRef, useValue: { close: closeSpy } },
        { provide: ProductsService, useValue: { bulkUpdateStatus } },
      ],
    });
    fixture = TestBed.createComponent(BulkStatusDialogComponent);
    cmp = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('renders the count + three status options', () => {
    configure(['a', 'b', 'c']);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h2')?.textContent).toContain('3 products');
    expect(el.querySelector('[data-testid="bulk-status-option-DRAFT"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="bulk-status-option-ACTIVE"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="bulk-status-option-ARCHIVED"]')).toBeTruthy();
  });

  it('disables submit until a status is picked', () => {
    configure();
    const submit = fixture.nativeElement.querySelector(
      '[data-testid="bulk-status-submit"] button',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    cmp.form.controls.status.setValue('ACTIVE');
    fixture.detectChanges();
    expect(submit.disabled).toBe(false);
  });

  it('calls bulkUpdateStatus on submit and closes with the result', () => {
    configure(['p1', 'p2']);
    cmp.form.controls.status.setValue('ARCHIVED');
    fixture.detectChanges();
    cmp.submit();
    expect(bulkUpdateStatus).toHaveBeenCalledWith({
      productIds: ['p1', 'p2'],
      status: 'ARCHIVED',
    });
    expect(closeSpy).toHaveBeenCalledWith({ status: 'ARCHIVED', count: 2 });
  });

  it('keeps the dialog open and surfaces an error banner when the service errors', () => {
    configure();
    bulkUpdateStatus.mockReturnValueOnce(
      throwError(() => new ApiServerError({ code: 'INTERNAL', message: 'boom', status: 500 })),
    );
    cmp.form.controls.status.setValue('ACTIVE');
    cmp.submit();
    fixture.detectChanges();
    expect(closeSpy).not.toHaveBeenCalled();
    expect(cmp.errorMessage()).toMatch(/boom|could not|retry/i);
  });

  it('surfaces ApiForbiddenError as the permission-specific error', () => {
    configure();
    bulkUpdateStatus.mockReturnValueOnce(
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    cmp.form.controls.status.setValue('ACTIVE');
    cmp.submit();
    fixture.detectChanges();
    expect(closeSpy).not.toHaveBeenCalled();
    expect(cmp.errorMessage()).toContain('permission');
  });

  it('surfaces ApiNotFoundError as the product-not-found error', () => {
    configure();
    bulkUpdateStatus.mockReturnValueOnce(
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    cmp.form.controls.status.setValue('ACTIVE');
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

  it('is a11y-clean with no status selected and after selecting one', async () => {
    configure();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
    cmp.form.controls.status.setValue('DRAFT');
    fixture.detectChanges();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });
});
