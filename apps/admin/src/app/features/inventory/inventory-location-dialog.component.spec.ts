import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InventoryService } from '@admin-services';
import { ApiConflictError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { InventoryLocationDialogComponent } from './inventory-location-dialog.component';

expect.extend(toHaveNoViolations);

describe('InventoryLocationDialogComponent', () => {
  let fixture: ComponentFixture<InventoryLocationDialogComponent>;
  let createSpy: jest.Mock;
  let updateSpy: jest.Mock;
  const close = jest.fn();

  function configure(data: unknown = {}) {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: InventoryService,
          useValue: { createLocation: createSpy, updateLocation: updateSpy },
        },
        { provide: DialogRef, useValue: { close } },
        { provide: DIALOG_DATA, useValue: data },
      ],
    });
    fixture = TestBed.createComponent(InventoryLocationDialogComponent);
    fixture.detectChanges();
  }

  beforeEach(() => {
    createSpy = jest.fn(() => of({ id: 'loc-1', name: 'Main', code: 'MAIN', isActive: true }));
    updateSpy = jest.fn(() => of({ id: 'loc-1', name: 'Main', code: 'MAIN', isActive: true }));
    close.mockReset();
  });

  it('mounts in create mode with an empty form', () => {
    configure();
    expect(fixture.componentInstance.isEdit()).toBe(false);
    expect(fixture.componentInstance.form.controls.name.value).toBe('');
  });

  it('surfaces conflict copy on ApiConflictError', () => {
    createSpy = jest.fn(() =>
      throwError(() => new ApiConflictError({ code: 'CONFLICT', message: 'duplicate' })),
    );
    configure();
    fixture.componentInstance.form.patchValue({ name: 'Main', code: 'MAIN' });
    fixture.componentInstance.submit();
    expect(fixture.componentInstance.error()).toBe('A location with this code already exists.');
  });

  it('surfaces a forbidden copy on ApiForbiddenError', () => {
    createSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    fixture.componentInstance.form.patchValue({ name: 'Main', code: 'MAIN' });
    fixture.componentInstance.submit();
    expect(fixture.componentInstance.error()).toContain('permission');
  });

  it('surfaces the not-found copy on ApiNotFoundError', () => {
    updateSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure({ location: { id: 'loc-1', name: 'Main', code: 'MAIN', isActive: true } });
    fixture.componentInstance.submit();
    expect(fixture.componentInstance.error()).toBe('Location not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
