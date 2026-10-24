import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, type ParamMap } from '@angular/router';
import { TaxService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AuthStore } from '../../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../../core/tokens';
import { TaxZoneEditorPage } from './tax-zone-editor.page';

expect.extend(toHaveNoViolations);

const zoneFixture = {
  id: 'z1',
  name: 'TVA France',
  countries: ['TN'],
  rate: 0.19,
  isDefault: false,
  isCompound: false,
  priority: 0,
  isActive: true,
};

describe('TaxZoneEditorPage', () => {
  let fixture: ComponentFixture<TaxZoneEditorPage>;
  let page: TaxZoneEditorPage;
  let getSpy: jest.Mock;
  let updateSpy: jest.Mock;
  let paramMap$: BehaviorSubject<ParamMap>;

  function configure(id = 'z1', perms: string[] = ['settings:view', 'settings:manage']) {
    paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({ id }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: TaxService, useValue: { getZone: getSpy, updateZone: updateSpy } },
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$.asObservable() } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(TaxZoneEditorPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    getSpy = jest.fn(() => of(zoneFixture));
    updateSpy = jest.fn((_id: string, body: Record<string, unknown>) =>
      of({ ...zoneFixture, ...body }),
    );
  });

  it('seeds rate as percent (0.19 → 19)', () => {
    configure();
    expect(page.form.controls.ratePercent.value).toBe(19);
    expect(page.form.controls.countries.value).toBe('TN');
  });

  it('countriesError flags non-ISO-alpha-2 tokens', () => {
    configure();
    page.form.controls.countries.setValue('france');
    page.form.controls.countries.markAsTouched();
    expect(page.countriesError()).toContain('not a valid');
  });

  it('save converts percent back to fractional rate', () => {
    configure();
    page.form.controls.ratePercent.setValue(10);
    page.form.controls.ratePercent.markAsDirty();
    page.save();
    expect(updateSpy).toHaveBeenCalledWith('z1', expect.objectContaining({ rate: 0.1 }));
  });

  it('save normalizes comma-separated countries into an uppercase array', () => {
    configure();
    page.form.controls.countries.setValue('ae, sa, kw');
    page.form.controls.countries.markAsDirty();
    page.save();
    expect(updateSpy).toHaveBeenCalledWith(
      'z1',
      expect.objectContaining({
        countries: ['AE', 'SA', 'KW'],
      }),
    );
  });

  it('ApiNotFoundError surfaces a clear error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure('zzz');
    expect(page.error()).toBe('Tax zone not found.');
  });

  it('ApiForbiddenError surfaces a permission error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure('zzz');
    expect(page.error()).toContain('permission');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
