import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SettingsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { SettingsGeneralPage } from './settings-general.page';
import { provideCurrencyStoreStub } from '../../../testing/currency-store.mock';

expect.extend(toHaveNoViolations);

/**
 * Mirrors the real `GET /v1/admin/settings` envelope. `currencyConfig` lives
 * under `localization`, not `general` — the old fixture encoded the same wrong
 * group as the code under test, so the suite stayed green while the real API
 * always fell through to a USD fallback.
 */
const fixture = {
  general: {
    storeName: { default: 'Acme', en: 'Acme' },
    contactEmail: 'ops@acme.com',
    phone: '+974 1234',
    socialLinks: { facebook: 'https://facebook.com/seeded' },
  },
  localization: {
    timezone: 'Europe/Paris',
    currencyConfig: { code: 'XTS', symbol: 'DT', decimalPlaces: 3 },
  },
  identity: {
    brandName: 'acme',
    description: { default: 'A demo store' },
  },
  business: {
    taxRegistrationNumber: '1234567/A/M/000',
    legalName: { default: 'Acme SARL' },
    tradingName: { default: 'Acme' },
    streetAddress: { default: '1 Main Street' },
    addressLocality: 'Paris',
    addressRegion: 'Ile-de-France',
    postalCode: '75001',
    addressCountry: 'FR',
  },
};

describe('SettingsGeneralPage', () => {
  let component: ComponentFixture<SettingsGeneralPage>;
  let page: SettingsGeneralPage;
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
    component = TestBed.createComponent(SettingsGeneralPage);
    page = component.componentInstance;
    component.detectChanges();
  }

  beforeEach(() => {
    getSpy = jest.fn(() => of(fixture));
    updateSpy = jest.fn((body: Record<string, unknown>) =>
      of({ ...fixture, general: { ...fixture.general, ...body } }),
    );
  });

  it('seeds the form from the grouped envelope', () => {
    configure();
    expect(page.form.controls.timezone.value).toBe('Europe/Paris');
    expect(page.form.controls.contactEmail.value).toBe('ops@acme.com');
  });

  // A6: this screen used to be a second currency editor. It read the wrong
  // settings group so it always showed USD, and saving `{ code }` alone
  // replaced the whole stored object.
  describe('store currency', () => {
    it('shows the currency read-only, sourced from the store', () => {
      configure();
      const root = component.nativeElement as HTMLElement;
      const row = root.querySelector('[data-testid="settings-store-currency"]');

      expect(row?.textContent).toContain('XTS');
      expect(root.querySelector('#gen-currency')).toBeNull();
      expect(root.textContent).not.toContain('Default currency');
    });

    it('links to the real editor', () => {
      configure();
      const root = component.nativeElement as HTMLElement;
      const link = root.querySelector('[data-testid="settings-currency-link"]');
      expect(link?.getAttribute('href')).toBe('/currencies');
    });

    it('never sends currencyConfig, whatever else changed', () => {
      configure();
      page.form.controls.timezone.setValue('Europe/London');
      page.form.controls.timezone.markAsDirty();
      page.save();

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy.mock.calls[0][0]).not.toHaveProperty('currencyConfig');
    });
  });

  describe('tax registration number (matricule fiscal)', () => {
    it('seeds from the business group, which no control on this screen read before', () => {
      configure();
      expect(page.form.controls.taxRegistrationNumber.value).toBe('1234567/A/M/000');
    });

    it('sends the field only when it is dirty', () => {
      configure();
      page.form.controls.timezone.setValue('Europe/Paris');
      page.form.controls.timezone.markAsDirty();
      page.save();
      expect(updateSpy.mock.calls[0][0]).not.toHaveProperty('taxRegistrationNumber');
    });

    it('sends a trimmed value when edited', () => {
      configure();
      page.form.controls.taxRegistrationNumber.setValue('  0011223/B/N/001  ');
      page.form.controls.taxRegistrationNumber.markAsDirty();
      page.save();
      expect(updateSpy.mock.calls[0][0]).toMatchObject({
        taxRegistrationNumber: '0011223/B/N/001',
      });
    });

    it('rejects a value past the column length rather than sending it', () => {
      configure();
      page.form.controls.taxRegistrationNumber.setValue('x'.repeat(65));
      page.form.controls.taxRegistrationNumber.markAsDirty();
      expect(page.form.controls.taxRegistrationNumber.valid).toBe(false);
      page.save();
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  it('save is a no-op when pristine', () => {
    configure();
    page.save();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('ApiForbiddenError surfaces a permission-safe error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('ApiNotFoundError surfaces the settings-not-found error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Settings not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(component.nativeElement);
    expect(results).toHaveNoViolations();
  });

  describe('social links', () => {
    /**
     * `socialLinks` has been a valid API key with a default since the settings
     * module shipped, and this is the only screen that edits store identity,
     * so the operator had no editor for it at all. The storefront footer reads
     * it now (plan I phase I2), which makes the gap visible.
     */
    it('renders one input per supported platform', () => {
      configure();
      for (const platform of ['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok']) {
        expect(
          component.nativeElement.querySelector(`[data-testid="settings-social-${platform}"]`),
        ).toBeTruthy();
      }
    });

    it('seeds each input from the stored value', () => {
      configure();
      expect(page.form.controls.socialLinks.controls.facebook.value).toBe(
        'https://facebook.com/seeded',
      );
      expect(page.form.controls.socialLinks.controls.instagram.value).toBe('');
    });

    it('sends the whole object, so a cleared platform is actually cleared', () => {
      // The API upsert replaces the JSON value wholesale, so sending only the
      // changed platform would erase every other one.
      configure();
      page.form.controls.socialLinks.controls.instagram.setValue('https://instagram.com/demostore');
      page.form.controls.socialLinks.markAsDirty();
      page.save();
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          socialLinks: {
            facebook: 'https://facebook.com/seeded',
            instagram: 'https://instagram.com/demostore',
            twitter: '',
            linkedin: '',
            tiktok: '',
          },
        }),
      );
    });

    it('leaves socialLinks out of the body when no platform was touched', () => {
      configure();
      page.form.controls.phone.setValue('+216 71 000 000');
      page.form.controls.phone.markAsDirty();
      page.save();
      expect(updateSpy).toHaveBeenCalledWith(expect.not.objectContaining({ socialLinks: {} }));
    });

    it('rejects a value that is not an absolute http(s) URL', () => {
      configure();
      const control = page.form.controls.socialLinks.controls.facebook;
      control.setValue('facebook.com/demostore');
      control.markAsTouched();
      expect(page.socialError('facebook')).toContain('https://');
      expect(page.form.invalid).toBe(true);
    });

    it('accepts an empty value, which is how a platform is removed', () => {
      configure();
      const control = page.form.controls.socialLinks.controls.facebook;
      control.setValue('');
      control.markAsTouched();
      expect(page.socialError('facebook')).toBeNull();
    });
  });

  /**
   * Plan E3.1.2. The identity group and four of the business keys were
   * registered, defaulted, and had no control on any screen, so the only way
   * to set a store's brand slug or its legal entity was a database seed.
   */
  describe('identity and legal entity', () => {
    it('seeds from the identity and business groups', () => {
      configure();

      expect(page.form.controls.brandName.value).toBe('acme');
      expect(page.form.controls.description.value).toEqual({ default: 'A demo store' });
      expect(page.form.controls.legalName.value).toEqual({ default: 'Acme SARL' });
      expect(page.form.controls.addressLocality.value).toBe('Paris');
      expect(page.form.controls.addressCountry.value).toBe('FR');
    });

    it('sends each field only when it is dirty', () => {
      configure();
      page.form.controls.brandName.setValue('acme-store');
      page.form.controls.brandName.markAsDirty();
      page.form.markAsDirty();
      page.save();

      expect(updateSpy).toHaveBeenCalledWith({ brandName: 'acme-store' });
    });

    it('sends the whole Translatable object for a legal name', () => {
      configure();
      page.form.controls.legalName.setValue({ default: 'Acme SAS', fr: 'Acme SAS' });
      page.form.controls.legalName.markAsDirty();
      page.form.markAsDirty();
      page.save();

      expect(updateSpy).toHaveBeenCalledWith({
        legalName: { default: 'Acme SAS', fr: 'Acme SAS' },
      });
    });

    it('refuses a brand slug the API would reject rather than sending it', () => {
      configure();
      page.form.controls.brandName.setValue('Acme Store');
      page.form.controls.brandName.markAsDirty();
      page.form.markAsDirty();
      page.save();

      expect(updateSpy).not.toHaveBeenCalled();
      expect(page.brandNameError()).toContain('Lowercase');
    });

    it('refuses a country that is not an alpha-2 code', () => {
      configure();
      page.form.controls.addressCountry.setValue('France');
      page.form.controls.addressCountry.markAsDirty();
      page.form.markAsDirty();
      page.save();

      expect(updateSpy).not.toHaveBeenCalled();
      expect(page.countryError()).toContain('Two uppercase letters');
    });

    it('accepts an empty country, which is how it stays unset', () => {
      configure();
      page.form.controls.addressCountry.setValue('');
      page.form.controls.addressCountry.markAsTouched();

      expect(page.countryError()).toBeNull();
    });
  });
});
