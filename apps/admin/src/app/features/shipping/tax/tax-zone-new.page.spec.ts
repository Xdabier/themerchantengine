import { ApiConflictError, ApiError, ApiForbiddenError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TaxService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../../core/tokens';
import { TaxZoneNewPage } from './tax-zone-new.page';

expect.extend(toHaveNoViolations);

const zoneFixture = {
  id: 'z-new-1',
  name: 'TVA France',
  countries: ['TN'],
  rate: 0.19,
  priority: 0,
  isDefault: false,
  isCompound: false,
  isActive: true,
};

describe('TaxZoneNewPage', () => {
  let fixture: ComponentFixture<TaxZoneNewPage>;
  let page: TaxZoneNewPage;
  let createSpy: jest.Mock;
  let navigateSpy: jest.SpyInstance;

  function configure(perms: string[] = ['settings:view', 'settings:manage']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: TaxService, useValue: { createZone: createSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    const router = TestBed.inject(Router);
    navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(TaxZoneNewPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  function fillValid(): void {
    page.form.controls.name.setValue('Test VAT');
    page.form.controls.name.markAsDirty();
    page.form.controls.ratePercent.setValue(19);
    page.form.controls.ratePercent.markAsDirty();
    page.form.controls.countries.setValue('TN');
    page.form.controls.countries.markAsDirty();
    page.form.markAsDirty();
  }

  beforeEach(() => {
    createSpy = jest.fn(() => of(zoneFixture));
  });

  it('requires name', () => {
    configure();
    page.form.controls.name.setValue('');
    page.form.controls.name.markAsTouched();
    expect(page.nameError()).toBe('Name is required.');
  });

  it('rejects a name longer than 100 characters', () => {
    configure();
    page.form.controls.name.setValue('a'.repeat(101));
    page.form.controls.name.markAsTouched();
    expect(page.nameError()).toContain('100 characters');
  });

  it('requires ratePercent', () => {
    configure();
    page.form.controls.ratePercent.setValue(null as unknown as number);
    page.form.controls.ratePercent.markAsTouched();
    expect(page.rateError()).toBe('Rate is required.');
  });

  it('rejects ratePercent below 0', () => {
    configure();
    page.form.controls.ratePercent.setValue(-1);
    page.form.controls.ratePercent.markAsTouched();
    expect(page.rateError()).toContain('between 0 and 100');
  });

  it('rejects ratePercent above 100', () => {
    configure();
    page.form.controls.ratePercent.setValue(101);
    page.form.controls.ratePercent.markAsTouched();
    expect(page.rateError()).toContain('between 0 and 100');
  });

  it('requires at least one country token', () => {
    configure();
    page.form.controls.countries.setValue('');
    page.form.controls.countries.markAsTouched();
    expect(page.countriesError()).toContain('at least one');
  });

  it('flags non-ISO-alpha-2 tokens', () => {
    configure();
    page.form.controls.countries.setValue('france');
    page.form.controls.countries.markAsTouched();
    expect(page.countriesError()).toContain('not a valid');
  });

  it('accepts a comma-separated country list without error', () => {
    configure();
    page.form.controls.countries.setValue('ae, sa, kw');
    page.form.controls.countries.markAsTouched();
    expect(page.countriesError()).toBeNull();
  });

  it('save is a no-op while pristine', () => {
    configure();
    page.save();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('save converts ratePercent to a 0..1 fraction and POSTs', () => {
    configure();
    fillValid();
    page.save();
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: { default: 'Test VAT' },
        rate: 0.19,
        countries: ['TN'],
      }),
    );
  });

  it('save forwards optional flags when set', () => {
    configure();
    fillValid();
    page.form.controls.isDefault.setValue(true);
    page.form.controls.isDefault.markAsDirty();
    page.form.controls.isCompound.setValue(true);
    page.form.controls.isCompound.markAsDirty();
    page.form.controls.priority.setValue(3);
    page.form.controls.priority.markAsDirty();
    page.save();
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ isDefault: true, isCompound: true, priority: 3 }),
    );
  });

  it('redirects to the zone editor on success', async () => {
    configure();
    fillValid();
    page.save();
    await Promise.resolve();
    expect(navigateSpy).toHaveBeenCalledWith(['/shipping/tax', zoneFixture.id]);
  });

  it('surfaces ApiError message in the banner', () => {
    createSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'INTERNAL_ERROR', message: 'Server on fire.' })),
    );
    configure();
    fillValid();
    page.save();
    expect(page.error()).toBe('Server on fire.');
  });

  it('surfaces a generic fallback when ApiError has no message', () => {
    createSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'INTERNAL_ERROR', message: '' })),
    );
    configure();
    fillValid();
    page.save();
    expect(page.error()).toBe('Could not create tax zone.');
  });

  it('surfaces a permission-safe copy on ApiForbiddenError', () => {
    createSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'no' })),
    );
    configure();
    fillValid();
    page.save();
    expect(page.error()).toContain('permission');
  });

  it('surfaces the conflict copy on ApiConflictError', () => {
    createSpy = jest.fn(() =>
      throwError(() => new ApiConflictError({ code: 'CONFLICT', message: 'Zone already exists.' })),
    );
    configure();
    fillValid();
    page.save();
    expect(page.error()).toBe('Zone already exists.');
  });

  it('clears the banner on a retried successful save', () => {
    let call = 0;
    createSpy = jest.fn(() => {
      if (++call === 1) {
        return throwError(() => new ApiError({ code: 'INTERNAL_ERROR', message: 'flake' }));
      }
      return of(zoneFixture);
    });
    configure();
    fillValid();
    page.save();
    expect(page.error()).toBe('flake');
    page.save();
    expect(page.error()).toBeNull();
  });

  it('renders a forbidden notice for settings:view-only sessions', () => {
    configure(['settings:view']);
    expect(fixture.nativeElement.querySelector('[data-testid="tax-zone-new-forbidden"]')).not.toBe(
      null,
    );
    expect(fixture.nativeElement.querySelector('form')).toBe(null);
  });

  it('has no axe violations on the ready form', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations after the form is dirtied', async () => {
    configure();
    fillValid();
    fixture.detectChanges();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations on the error banner render', async () => {
    createSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'INTERNAL_ERROR', message: 'fail' })),
    );
    configure();
    fillValid();
    page.save();
    fixture.detectChanges();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in the forbidden state', async () => {
    configure(['settings:view']);
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
