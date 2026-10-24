import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SettingsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';
import { LOCALE_CATALOGUE } from '@common/locale';
import { SettingsLocalesPage } from './settings-locales.page';

expect.extend(toHaveNoViolations);

/** The grouped envelope the screen reads, not the locales endpoint's pair. */
const fixture = {
  general: {},
  localization: {
    supportedLocales: ['fr', 'en'],
    defaultLocale: 'fr',
    rtlLocales: [],
  },
};

describe('SettingsLocalesPage', () => {
  let component: ComponentFixture<SettingsLocalesPage>;
  let page: SettingsLocalesPage;
  let getSpy: jest.Mock;
  let updateSpy: jest.Mock;
  let patchSpy: jest.Mock;

  function configure(perms: string[] = ['settings:view', 'settings:manage']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        provideStoreSettingsStub(),
        {
          provide: SettingsService,
          useValue: { getAll: getSpy, updateLocales: updateSpy, update: patchSpy },
        },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    component = TestBed.createComponent(SettingsLocalesPage);
    page = component.componentInstance;
    component.detectChanges();
  }

  beforeEach(() => {
    getSpy = jest.fn(() => of(fixture));
    updateSpy = jest.fn((body: Record<string, unknown>) => of(body));
    patchSpy = jest.fn((body: Record<string, unknown>) => of(body));
  });

  it('seeds supported + default', () => {
    configure();
    expect(page.isSupported('fr')).toBe(true);
    expect(page.isSupported('en')).toBe(true);
    expect(page.defaultLocale()).toBe('fr');
  });

  it('disabling default clears defaultLocale', () => {
    configure();
    page.toggleSupported('fr', { target: { checked: false } } as unknown as Event);
    expect(page.defaultLocale()).toBeNull();
  });

  it('defaultValid is false when default is not in supported', () => {
    configure();
    page.onDefaultChange({ target: { value: 'de' } } as unknown as Event);
    expect(page.defaultValid()).toBe(false);
  });

  it('save refuses when default is not in supported', () => {
    configure();
    page.onDefaultChange({ target: { value: 'de' } } as unknown as Event);
    page.save();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(page.error()).toContain('Default locale must');
  });

  it('save PATCHes valid changes', () => {
    configure();
    page.toggleSupported('ar', { target: { checked: true } } as unknown as Event);
    page.save();
    expect(updateSpy).toHaveBeenCalledWith({
      supportedLocales: ['fr', 'en', 'ar'],
      defaultLocale: 'fr',
      rtlLocales: ['ar'],
    });
  });

  it('refreshes the shared store settings after a save', () => {
    // Every Translatable editor takes its tab list from StoreSettingsStore, so a
    // save that does not refresh it leaves the whole app on the old locale set
    // until a full reload.
    configure();
    const store = TestBed.inject(StoreSettingsStore);
    const refresh = jest.spyOn(store, 'refresh');
    page.toggleSupported('ar', { target: { checked: true } } as unknown as Event);
    page.save();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('offers exactly the locales the engine ships strings for', () => {
    // The literal this replaced offered five, three of which the settings DTO
    // refuses, so the screen advertised locales the store could never enable.
    configure();
    const offered = Array.from(
      component.nativeElement.querySelectorAll('[data-testid^="settings-locale-"]'),
    ).map((el) => (el as HTMLElement).getAttribute('data-testid'));
    expect(offered).toEqual(LOCALE_CATALOGUE.map((code) => `settings-locale-${code}`));
  });

  it('refuses to send a stored locale the engine no longer ships', () => {
    // The read schema is loose on purpose, so a locale outside the catalogue
    // reaches the screen that exists to correct it. Sending it back would be a
    // 400 from the settings DTO, so the screen names the refusal instead.
    getSpy = jest.fn(() =>
      of({
        general: {},
        localization: { supportedLocales: ['fr', 'es'], defaultLocale: 'fr', rtlLocales: [] },
      }),
    );
    configure();
    // Something else has to change first, or the form is pristine and save is
    // a no-op. That is the real shape of it: the operator edits one locale and
    // the stale one rides along in the same body.
    page.toggleSupported('en', { target: { checked: true } } as unknown as Event);
    page.save();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(page.error()).toContain('es');
  });

  it('ApiForbiddenError surfaces a permission-safe error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('ApiNotFoundError surfaces the locales-not-found error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Locales not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(component.nativeElement);
    expect(results).toHaveNoViolations();
  });

  /**
   * Plan E3.1.4 and E3.4.2. `rtlLocales` was a registered, defaulted settings
   * key with no editor anywhere, and it is what every Translatable tab in the
   * admin reads to decide which way it types.
   */
  describe('writing direction', () => {
    it('shows the registry direction for each locale the store enabled, without a toggle', () => {
      configure();
      const root: HTMLElement = component.nativeElement;
      const shown = Array.from(root.querySelectorAll('[data-testid^="settings-direction-"]')).map(
        (el) => [el.getAttribute('data-testid'), el.textContent?.trim()],
      );

      expect(shown).toEqual([
        ['settings-direction-fr', 'Left to right'],
        ['settings-direction-en', 'Left to right'],
      ]);
      expect(root.querySelector('[data-testid^="settings-rtl-"]')).toBeNull();
    });

    it('shows a right-to-left locale as such once it is enabled', () => {
      configure();
      page.toggleSupported('ar', { target: { checked: true } } as unknown as Event);
      component.detectChanges();

      const ar: HTMLElement = component.nativeElement.querySelector(
        '[data-testid="settings-direction-ar"]',
      );
      expect(ar.textContent?.trim()).toBe('Right to left');
    });

    it('writes the registry direction in the same call as the pair', () => {
      // One request, one transaction: the API checks the subset against the
      // body when it carries rtlLocales.
      configure();
      page.toggleSupported('ar', { target: { checked: true } } as unknown as Event);
      page.save();

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith({
        supportedLocales: ['fr', 'en', 'ar'],
        defaultLocale: 'fr',
        rtlLocales: ['ar'],
      });
      expect(patchSpy).not.toHaveBeenCalled();
    });

    it('sends an empty direction set when no right-to-left locale is enabled', () => {
      configure();
      page.toggleSupported('en', { target: { checked: false } } as unknown as Event);
      page.save();

      expect(updateSpy).toHaveBeenCalledWith({
        supportedLocales: ['fr'],
        defaultLocale: 'fr',
        rtlLocales: [],
      });
      expect(patchSpy).not.toHaveBeenCalled();
    });

    it('drops a direction for a locale the same save disabled', () => {
      // Disabling the only right-to-left locale has to clear its direction in
      // the same call, or the API refuses the stored set as not a subset.
      getSpy = jest.fn(() =>
        of({
          general: {},
          localization: {
            supportedLocales: ['fr', 'ar'],
            defaultLocale: 'fr',
            rtlLocales: ['ar'],
          },
        }),
      );
      configure();
      page.toggleSupported('ar', { target: { checked: false } } as unknown as Event);
      page.save();

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith({
        supportedLocales: ['fr'],
        defaultLocale: 'fr',
        rtlLocales: [],
      });
      expect(patchSpy).not.toHaveBeenCalled();
    });

    it('corrects a stored direction that disagrees with the registry', () => {
      getSpy = jest.fn(() =>
        of({
          general: {},
          localization: { supportedLocales: ['fr', 'ar'], defaultLocale: 'fr', rtlLocales: [] },
        }),
      );
      configure();

      expect(page.dirty()).toBe(true);
      page.save();
      expect(updateSpy).toHaveBeenCalledWith({
        supportedLocales: ['fr', 'ar'],
        defaultLocale: 'fr',
        rtlLocales: ['ar'],
      });
    });

    it('is clean again after a save that changed the direction', () => {
      configure();
      page.toggleSupported('ar', { target: { checked: true } } as unknown as Event);
      page.save();

      expect(page.dirty()).toBe(false);
    });

    it('reports a failed save as one failure, with nothing half saved', () => {
      updateSpy = jest.fn(() =>
        throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
      );
      configure();
      page.toggleSupported('ar', { target: { checked: true } } as unknown as Event);
      page.save();

      expect(page.error()).toBe('You do not have permission to manage locales.');
      expect(patchSpy).not.toHaveBeenCalled();
    });
  });
});
