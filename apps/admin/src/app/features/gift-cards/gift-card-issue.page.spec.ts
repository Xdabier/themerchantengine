import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { GiftCardsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { GiftCardIssuePage } from './gift-card-issue.page';
import { XTS_STORE, provideCurrencyStoreStub } from '../../../testing/currency-store.mock';
import type { StoreCurrency } from '@admin-services';

expect.extend(toHaveNoViolations);

describe('GiftCardIssuePage', () => {
  let fixture: ComponentFixture<GiftCardIssuePage>;
  let page: GiftCardIssuePage;
  let issueSpy: jest.Mock;
  let navigateSpy: jest.SpyInstance;

  function configure(currency: StoreCurrency | null = XTS_STORE) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: GiftCardsService, useValue: { issue: issueSpy } },
        provideCurrencyStoreStub(currency),
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: {
        id: 'u',
        email: 'a@b',
        permissions: ['gift_cards:create'],
        roles: [],
        status: 'active',
      },
    });
    navigateSpy = jest.spyOn(TestBed.inject(Router), 'navigate');
    fixture = TestBed.createComponent(GiftCardIssuePage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    issueSpy = jest.fn(() =>
      of({
        id: 'g-new',
        code: 'GIFT-NEW',
        initialBalance: 100,
        currentBalance: 100,
        currency: 'EUR',
        isActive: true,
        createdAt: new Date().toISOString(),
      }),
    );
  });

  afterEach(() => navigateSpy?.mockRestore());

  it('amount validator requires at least 1', () => {
    configure();
    page.form.controls.initialBalance.setValue(0);
    page.form.controls.initialBalance.markAsTouched();
    expect(page.amountError()).toContain('at least 1');
  });

  it('email validator rejects invalid emails', () => {
    configure();
    page.form.controls.recipientEmail.setValue('not-an-email');
    page.form.controls.recipientEmail.markAsTouched();
    expect(page.emailError()).toContain('valid email');
  });

  it('submit posts only the filled fields', () => {
    configure();
    page.form.setValue({
      initialBalance: 50,
      currency: 'EUR',
      expiresAt: '',
      recipientEmail: '',
      recipientName: '',
      sendNow: true,
    });
    page.submit();
    expect(issueSpy).toHaveBeenCalledWith({
      initialBalance: 50,
      currency: 'EUR',
    });
  });

  it('sendNow=false strips the recipient email from the payload', () => {
    configure();
    page.form.setValue({
      initialBalance: 25,
      currency: 'EUR',
      expiresAt: '',
      recipientEmail: 'a@b.com',
      recipientName: 'A',
      sendNow: false,
    });
    page.submit();
    expect(issueSpy).toHaveBeenCalledWith({
      initialBalance: 25,
      currency: 'EUR',
      recipientName: 'A',
    });
  });

  it('navigates to the new card on success', () => {
    configure();
    page.form.setValue({
      initialBalance: 10,
      currency: 'EUR',
      expiresAt: '',
      recipientEmail: '',
      recipientName: '',
      sendNow: false,
    });
    page.submit();
    expect(navigateSpy).toHaveBeenCalledWith(['/gift-cards', 'g-new']);
  });

  it('ApiForbiddenError surfaces a permission-safe error', () => {
    issueSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    page.form.setValue({
      initialBalance: 10,
      currency: 'EUR',
      expiresAt: '',
      recipientEmail: '',
      recipientName: '',
      sendNow: false,
    });
    page.submit();
    expect(page.error()).toContain('permission');
  });

  it('ApiNotFoundError surfaces the gift-card-not-found error', () => {
    issueSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    page.form.setValue({
      initialBalance: 10,
      currency: 'EUR',
      expiresAt: '',
      recipientEmail: '',
      recipientName: '',
      sendNow: false,
    });
    page.submit();
    expect(page.error()).toBe('Gift card not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
  // A5: the form used to default to USD and really issued USD cards in a
  // EUR-only store.
  describe('currency control', () => {
    it('preselects the store currency and offers only the enabled codes', () => {
      configure();
      const root = fixture.nativeElement as HTMLElement;
      const select = root.querySelector('[data-testid="gc-currency-select"]') as HTMLSelectElement;

      expect(select).not.toBeNull();
      expect(page.form.controls.currency.value).toBe('XTS');
      expect(Array.from(select.options).map((o) => o.value)).toEqual(['XTS']);
    });

    it('lists every enabled currency when the store accepts more than one', () => {
      configure({ code: 'XTS', symbol: 'DT', decimalPlaces: 3, enabled: ['XTS', 'EUR'] });
      const root = fixture.nativeElement as HTMLElement;
      const select = root.querySelector('[data-testid="gc-currency-select"]') as HTMLSelectElement;

      expect(Array.from(select.options).map((o) => o.value)).toEqual(['XTS', 'EUR']);
    });

    // Better an invalid form than a confidently wrong currency.
    it('stays empty and invalid while the store currency is unknown', () => {
      configure(null);
      expect(page.form.controls.currency.value).toBe('');
      expect(page.form.controls.currency.invalid).toBe(true);
      expect(page.form.invalid).toBe(true);
    });

    it('submits the store currency', () => {
      configure();
      page.form.patchValue({ initialBalance: 50 });
      page.submit();
      expect(issueSpy).toHaveBeenCalledWith(expect.objectContaining({ currency: 'XTS' }));
    });
  });
});
