import { ApiForbiddenError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SettingsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { provideCurrencyStoreStub } from '../../../testing/currency-store.mock';
import { SettingsMoneyPage } from './settings-money.page';

expect.extend(toHaveNoViolations);

const fixture = {
  general: {},
  localization: {
    currencyConfig: { code: 'XTS', symbol: 'DT', decimalPlaces: 3 },
  },
  money: {
    symbolPosition: 'after',
    decimalSeparator: ',',
    thousandsSeparator: ' ',
    taxDisplay: 'TTC',
    vatRate: 0.19,
  },
};

/**
 * Plan E3.1.5. The money group had no editor, so `symbolPosition`, the
 * separators, the tax mention and the VAT rate were seed-only, and the display
 * precision was reachable only through the currencies screen's own object.
 */
describe('SettingsMoneyPage', () => {
  let component: ComponentFixture<SettingsMoneyPage>;
  let page: SettingsMoneyPage;
  let getSpy: jest.Mock;
  let updateSpy: jest.Mock;

  function configure(perms: string[] = ['settings:view', 'settings:manage']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: SettingsService, useValue: { getAll: getSpy, update: updateSpy } },
        provideCurrencyStoreStub(),
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    component = TestBed.createComponent(SettingsMoneyPage);
    page = component.componentInstance;
    component.detectChanges();
  }

  beforeEach(() => {
    getSpy = jest.fn(() => of(fixture));
    updateSpy = jest.fn((body: Record<string, unknown>) => of({ ...fixture, ...body }));
  });

  it('seeds the format from the money group and the currency config', () => {
    configure();

    expect(page.form.controls.symbolPosition.value).toBe('after');
    expect(page.form.controls.decimalSeparator.value).toBe(',');
    expect(page.form.controls.taxDisplay.value).toBe('TTC');
    expect(page.form.controls.vatRate.value).toBe(0.19);
    // Display precision lives in currencyConfig, not in the money group.
    expect(page.form.controls.decimalPlaces.value).toBe(3);
    expect(page.form.controls.symbol.value).toBe('DT');
  });

  it('renders a sample in the configured format', () => {
    configure();

    expect(page.sample()).toBe('1 234 567,891 DT TTC');
  });

  it('moves the symbol in the sample when the position changes', () => {
    configure();
    page.form.controls.symbolPosition.setValue('before');
    component.detectChanges();

    expect(page.sample()).toBe('DT 1 234 567,891 TTC');
  });

  it('drops the fraction from the sample at zero precision', () => {
    configure();
    page.form.controls.decimalPlaces.setValue(0);
    component.detectChanges();

    expect(page.sample()).toBe('1 234 568 DT TTC');
  });

  it('sends the symbol and the precision together with the code', () => {
    // They are two keys of one stored object the API replaces wholesale, so
    // sending one alone would clear the other and the code with it.
    configure();
    page.form.controls.symbol.setValue('DTN');
    page.form.controls.symbol.markAsDirty();
    page.form.markAsDirty();
    page.save();

    expect(updateSpy).toHaveBeenCalledWith({
      currencyConfig: { code: 'XTS', symbol: 'DTN', decimalPlaces: 3 },
    });
  });

  it('sends only the money keys that changed', () => {
    configure();
    page.form.controls.taxDisplay.setValue('HT');
    page.form.controls.taxDisplay.markAsDirty();
    page.form.markAsDirty();
    page.save();

    expect(updateSpy).toHaveBeenCalledWith({ taxDisplay: 'HT' });
  });

  it('refuses two separators that are the same character', () => {
    configure();
    page.form.controls.thousandsSeparator.setValue(',');
    page.form.controls.thousandsSeparator.markAsDirty();
    page.form.markAsDirty();
    page.save();

    expect(updateSpy).not.toHaveBeenCalled();
    expect(page.separatorError()).toContain('must differ');
  });

  it('refuses a precision past the storage ceiling', () => {
    configure();
    page.form.controls.decimalPlaces.setValue(4);
    page.form.controls.decimalPlaces.markAsDirty();
    page.form.markAsDirty();
    page.save();

    expect(updateSpy).not.toHaveBeenCalled();
    expect(page.decimalPlacesError()).toContain('0 to 3');
  });

  it('refuses a VAT rate entered as a percentage', () => {
    configure();
    page.form.controls.vatRate.setValue(19);
    page.form.controls.vatRate.markAsDirty();
    page.form.markAsDirty();
    page.save();

    expect(updateSpy).not.toHaveBeenCalled();
    expect(page.vatRateError()).toContain('fraction');
  });

  it('surfaces ApiForbiddenError as a permission-safe message', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure(['settings:view']);

    expect(page.error()).toContain('permission');
  });

  it('has no axe violations', async () => {
    configure();

    expect(await axe(component.nativeElement)).toHaveNoViolations();
  });
});
