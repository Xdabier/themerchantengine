import { ApiConflictError, ApiError, ApiForbiddenError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { TaxService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Subject, of, throwError } from 'rxjs';
import { AuthStore } from '../../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../../core/tokens';
import { TaxClassNewPage } from './tax-class-new.page';

expect.extend(toHaveNoViolations);

const zones = [
  { id: 'z1', name: 'TVA France', countries: ['TN'], rate: 0.19, isActive: true },
  { id: 'z2', name: 'UAE VAT', countries: ['AE'], rate: 0.19, isActive: true },
];
const classFixture = {
  id: 'c-new-1',
  zoneId: 'z1',
  name: 'Standard',
  rate: 0.19,
  isDefault: false,
};

describe('TaxClassNewPage', () => {
  let fixture: ComponentFixture<TaxClassNewPage>;
  let page: TaxClassNewPage;
  let listZonesSpy: jest.Mock;
  let createClassSpy: jest.Mock;
  let navigateSpy: jest.SpyInstance;

  function configure(
    params: Record<string, string> = {},
    perms: string[] = ['settings:view', 'settings:manage'],
    listZonesImpl?: () => ReturnType<typeof of>,
  ) {
    if (listZonesImpl) listZonesSpy = jest.fn(listZonesImpl);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: TaxService,
          useValue: { listZones: listZonesSpy, createClass: createClassSpy },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap(params) },
            queryParams: new Subject(),
          },
        },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    const router = TestBed.inject(Router);
    navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(TaxClassNewPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  function fillValid(): void {
    page.form.controls.zoneId.setValue('z1');
    page.form.controls.zoneId.markAsDirty();
    page.form.controls.name.setValue('Standard');
    page.form.controls.name.markAsDirty();
    page.form.controls.ratePercent.setValue(19);
    page.form.controls.ratePercent.markAsDirty();
    page.form.markAsDirty();
  }

  beforeEach(() => {
    listZonesSpy = jest.fn(() => of({ data: zones, meta: { page: 1, pageSize: 100, total: 2 } }));
    createClassSpy = jest.fn(() => of(classFixture));
  });

  it('populates the zone select from listZones()', () => {
    configure();
    expect(page.zones()).toHaveLength(2);
    expect(page.zonesLoading()).toBe(false);
  });

  it('pre-selects the zoneId from the route query-param when valid', () => {
    configure({ zoneId: 'z2' });
    expect(page.form.controls.zoneId.value).toBe('z2');
  });

  it('ignores a route zoneId that is not in the store', () => {
    configure({ zoneId: 'bogus' });
    expect(page.form.controls.zoneId.value).toBe('');
  });

  it('surfaces an error when listZones() fails', () => {
    configure({}, undefined, () =>
      throwError(() => new ApiError({ code: 'INTERNAL_ERROR', message: 'zone load broke' })),
    );
    expect(page.error()).toBe('zone load broke');
    expect(page.zonesLoading()).toBe(false);
  });

  it('renders the zero-zones nudge when the store is empty', () => {
    configure({}, undefined, () => of({ data: [], meta: { page: 1, pageSize: 100, total: 0 } }));
    expect(
      fixture.nativeElement.querySelector('[data-testid="tax-class-new-no-zones"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('requires zoneId', () => {
    configure();
    page.form.controls.zoneId.setValue('');
    page.form.controls.zoneId.markAsTouched();
    expect(page.zoneError()).toBe('Pick a zone.');
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

  it('save is a no-op while pristine', () => {
    configure();
    page.save();
    expect(createClassSpy).not.toHaveBeenCalled();
  });

  it('save converts ratePercent to a 0..1 fraction and POSTs', () => {
    configure();
    fillValid();
    page.save();
    expect(createClassSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        zoneId: 'z1',
        name: 'Standard',
        rate: 0.19,
      }),
    );
  });

  it('save forwards isDefault when checked', () => {
    configure();
    fillValid();
    page.form.controls.isDefault.setValue(true);
    page.form.controls.isDefault.markAsDirty();
    page.save();
    expect(createClassSpy).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }));
  });

  it('redirects to /shipping/tax/classes?zoneId=<id> on success', async () => {
    configure();
    fillValid();
    page.save();
    await Promise.resolve();
    expect(navigateSpy).toHaveBeenCalledWith(['/shipping/tax/classes'], {
      queryParams: { zoneId: 'z1' },
    });
  });

  it('surfaces ApiError message in the banner', () => {
    createClassSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'INTERNAL_ERROR', message: 'Server on fire.' })),
    );
    configure();
    fillValid();
    page.save();
    expect(page.error()).toBe('Server on fire.');
  });

  it('surfaces the generic fallback when ApiError has no message', () => {
    createClassSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'INTERNAL_ERROR', message: '' })),
    );
    configure();
    fillValid();
    page.save();
    expect(page.error()).toBe('Could not create tax class.');
  });

  it('surfaces the permission-safe copy on ApiForbiddenError', () => {
    createClassSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'no' })),
    );
    configure();
    fillValid();
    page.save();
    expect(page.error()).toContain('permission');
  });

  it('surfaces the conflict copy on ApiConflictError', () => {
    createClassSpy = jest.fn(() =>
      throwError(
        () => new ApiConflictError({ code: 'CONFLICT', message: 'Class name already taken.' }),
      ),
    );
    configure();
    fillValid();
    page.save();
    expect(page.error()).toBe('Class name already taken.');
  });

  it('renders a forbidden notice for settings:view-only sessions', () => {
    configure({}, ['settings:view']);
    expect(
      fixture.nativeElement.querySelector('[data-testid="tax-class-new-forbidden"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('has no axe violations in the zones-loading state', async () => {
    configure({}, undefined, () => new Subject());
    expect(page.zonesLoading()).toBe(true);
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations on the ready form', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations on the error banner render', async () => {
    createClassSpy = jest.fn(() =>
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
    configure({}, ['settings:view']);
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in the zero-zones state', async () => {
    configure({}, undefined, () => of({ data: [], meta: { page: 1, pageSize: 100, total: 0 } }));
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
