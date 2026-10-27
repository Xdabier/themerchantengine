import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CheckoutSettingsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { CheckoutSettingsPage } from './checkout-settings.page';

expect.extend(toHaveNoViolations);

const settingsFixture = {
  guestCheckoutEnabled: true,
  requiredFields: ['email', 'phone'] as ('email' | 'phone')[],
  termsOfServiceUrl: 'https://example.com/tos',
  postPurchaseRedirectUrl: null,
  checkoutMessage: null,
};

describe('CheckoutSettingsPage', () => {
  let fixture: ComponentFixture<CheckoutSettingsPage>;
  let page: CheckoutSettingsPage;
  let getSpy: jest.Mock;
  let updateSpy: jest.Mock;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: CheckoutSettingsService, useValue: { get: getSpy, update: updateSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: {
        id: 'u',
        email: 'a@b',
        permissions: ['checkout:view', 'checkout:manage'],
        roles: [],
        status: 'active',
      },
    });
    fixture = TestBed.createComponent(CheckoutSettingsPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    getSpy = jest.fn(() => of(settingsFixture));
    updateSpy = jest.fn((body: Record<string, unknown>) => of({ ...settingsFixture, ...body }));
  });

  it('seeds the form + required-field selection', () => {
    configure();
    expect(page.form.controls.guestCheckoutEnabled.value).toBe(true);
    expect(page.isRequired('email')).toBe(true);
    expect(page.isRequired('phone')).toBe(true);
    expect(page.isRequired('company')).toBe(false);
  });

  it('toggleRequired flips + marks dirty', () => {
    configure();
    page.toggleRequired('company', { target: { checked: true } } as unknown as Event);
    expect(page.isRequired('company')).toBe(true);
    expect(page.requiredDirty()).toBe(true);
  });

  it('urlError flags malformed urls', () => {
    configure();
    page.form.controls.termsOfServiceUrl.setValue('not-a-url');
    expect(page.urlError('termsOfServiceUrl')).toContain('full URL');
  });

  it('save is a no-op when pristine', () => {
    configure();
    page.save();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('save ships dirty form + required-fields when toggled', () => {
    configure();
    page.form.controls.guestCheckoutEnabled.setValue(false);
    page.form.controls.guestCheckoutEnabled.markAsDirty();
    page.toggleRequired('company', { target: { checked: true } } as unknown as Event);
    page.save();
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        guestCheckoutEnabled: false,
        requiredFields: expect.arrayContaining(['email', 'phone', 'company']),
      }),
    );
  });

  it('empty string URL fields PATCH as null', () => {
    configure();
    page.form.controls.termsOfServiceUrl.setValue('');
    page.form.controls.termsOfServiceUrl.markAsDirty();
    page.save();
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ termsOfServiceUrl: null }));
  });

  it('ApiForbiddenError surfaces a permission-safe error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('ApiNotFoundError surfaces the checkout-settings-not-found error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Checkout settings not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
