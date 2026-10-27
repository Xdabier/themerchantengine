import { ApiConflictError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { UsersService } from '@admin-services';
import * as adminUi from '@admin-ui';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';
import { MePage } from './me.page';

expect.extend(toHaveNoViolations);

const meFixture = {
  id: 'u-1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  locale: 'en',
  roles: [{ id: 'r1', name: 'Admin', permissions: [] }],
  permissions: [],
  status: 'active' as const,
};

describe('MePage', () => {
  let fixture: ComponentFixture<MePage>;
  let page: MePage;
  let meSpy: jest.Mock;
  let updateSpy: jest.Mock;
  let confirmSpy: jest.SpyInstance;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        // MePage reads its locale options from StoreSettingsStore. Without the
        // stub the real store fires an unmocked /v1/admin/settings request that
        // resolves after teardown, and the option list is never a controlled
        // fixture.
        provideStoreSettingsStub(),
        { provide: UsersService, useValue: { me: meSpy, updateMe: updateSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: meFixture,
    });
    fixture = TestBed.createComponent(MePage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    meSpy = jest.fn(() => of(meFixture));
    updateSpy = jest.fn((body: Record<string, unknown>) => of({ ...meFixture, ...body }));
    confirmSpy = jest.spyOn(adminUi, 'openConfirmDialog').mockResolvedValue(true);
  });

  afterEach(() => confirmSpy.mockRestore());

  it('seeds the form from /users/me', () => {
    configure();
    expect(page.form.controls.firstName.value).toBe('Ada');
    expect(page.form.controls.email.value).toBe('ada@example.com');
    expect(page.form.controls.locale.value).toBe('en');
  });

  it('save is a no-op when pristine', async () => {
    configure();
    await page.save();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('save PATCHes only dirty fields', async () => {
    configure();
    page.form.controls.firstName.setValue('Grace');
    page.form.controls.firstName.markAsDirty();
    await page.save();
    expect(updateSpy).toHaveBeenCalledWith({ firstName: 'Grace' });
  });

  it('email change requires confirm', async () => {
    configure();
    page.form.controls.email.setValue('grace@example.com');
    page.form.controls.email.markAsDirty();
    await page.save();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith({ email: 'grace@example.com' });
  });

  it('email change skipped when operator cancels confirm', async () => {
    confirmSpy.mockResolvedValueOnce(false);
    configure();
    page.form.controls.email.setValue('grace@example.com');
    page.form.controls.email.markAsDirty();
    await page.save();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('ApiConflictError surfaces an email-conflict message', async () => {
    updateSpy = jest.fn(() =>
      throwError(() => new ApiConflictError({ code: 'CONFLICT', message: 'taken' })),
    );
    configure();
    page.form.controls.email.setValue('taken@example.com');
    page.form.controls.email.markAsDirty();
    await page.save();
    expect(page.error()).toContain('already in use');
  });

  it('ApiForbiddenError surfaces the permission-specific error', async () => {
    updateSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    page.form.controls.email.setValue('grace@example.com');
    page.form.controls.email.markAsDirty();
    await page.save();
    expect(page.error()).toContain('permission');
  });

  it('ApiNotFoundError surfaces the profile-not-found error', async () => {
    updateSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    page.form.controls.email.setValue('grace@example.com');
    page.form.controls.email.markAsDirty();
    await page.save();
    expect(page.error()).toBe('Profile not found.');
  });

  it('builds the language options from the store locales, not a hardcoded pair', () => {
    // D3.16's actual deliverable. Until now the only evidence that `/me` offers
    // French was a pixel baseline, and a dropdown's option list sits under the
    // 0.2 percent diff ratio, which is the coverage mode this phase already
    // found insufficient elsewhere.
    configure();
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="me-locale-select"]',
    ) as HTMLSelectElement;

    expect(Array.from(select.options).map((o) => o.value)).toEqual(['fr', 'en']);
    expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual([
      'Français',
      'English',
    ]);
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('save mirrors locale to AuthStore when locale control is dirty and response carries locale', async () => {
    configure();
    const authStore = TestBed.inject(AuthStore);
    const setLocaleSpy = jest.spyOn(authStore, 'setLocale');
    page.form.controls.locale.setValue('en');
    page.form.controls.locale.markAsDirty();

    await page.save();

    expect(updateSpy).toHaveBeenCalledWith({ locale: 'en' });
    expect(setLocaleSpy).toHaveBeenCalledWith('en');
  });

  it('save does not mirror locale when the locale control is pristine', async () => {
    configure();
    const authStore = TestBed.inject(AuthStore);
    const setLocaleSpy = jest.spyOn(authStore, 'setLocale');
    page.form.controls.firstName.setValue('Grace');
    page.form.controls.firstName.markAsDirty();

    await page.save();

    expect(setLocaleSpy).not.toHaveBeenCalled();
  });

  it('save does not mirror locale when the updated user carries a null locale', async () => {
    updateSpy = jest.fn((body: Record<string, unknown>) =>
      of({ ...meFixture, ...body, locale: null }),
    );
    configure();
    const authStore = TestBed.inject(AuthStore);
    const setLocaleSpy = jest.spyOn(authStore, 'setLocale');
    page.form.controls.locale.setValue('en');
    page.form.controls.locale.markAsDirty();

    await page.save();

    expect(setLocaleSpy).not.toHaveBeenCalled();
  });

  it('revert resets the form to the current user snapshot', () => {
    configure();
    page.form.controls.firstName.setValue('Grace');
    page.form.controls.firstName.markAsDirty();
    expect(page.form.dirty).toBe(true);

    page.revert();

    expect(page.form.controls.firstName.value).toBe('Ada');
    expect(page.form.dirty).toBe(false);
  });

  it('renders the error banner in the DOM when me() fails', () => {
    meSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    const banner = fixture.nativeElement.querySelector<HTMLElement>('[data-testid="me-error"] p');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Profile not found');
  });
});
