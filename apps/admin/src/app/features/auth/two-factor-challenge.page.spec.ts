import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { AuthService } from '@admin-services';
import type { AdminUser } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { TwoFactorChallengePage } from './two-factor-challenge.page';

expect.extend(toHaveNoViolations);

const adminUser: AdminUser = {
  id: 'a4f5c9a4-1a1a-4a4a-8a8a-aaaaaaaaaaaa',
  email: 'admin@merchants.test',
  roles: [],
  permissions: [],
  status: 'active',
};

describe('TwoFactorChallengePage', () => {
  let fixture: ComponentFixture<TwoFactorChallengePage>;
  let page: TwoFactorChallengePage;
  let store: AuthStore;
  let auth: { verifyTwoFactor: jest.Mock; getSession: jest.Mock };

  function setup(params: Record<string, string> = {}): void {
    auth = {
      verifyTwoFactor: jest.fn(() => Promise.resolve({ ok: true })),
      getSession: jest.fn(() => Promise.resolve(adminUser)),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: { queryParams: new BehaviorSubject(params) } },
      ],
    });
    store = TestBed.inject(AuthStore);
    fixture = TestBed.createComponent(TwoFactorChallengePage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('flags a missing code', () => {
    setup();
    page.form.controls.code.markAsTouched();
    expect(page.codeError()).toBe('Enter your authentication code.');
  });

  it('flags a non-6-digit code', () => {
    setup();
    page.form.controls.code.setValue('123');
    page.form.controls.code.markAsTouched();
    expect(page.codeError()).toBe('The code is 6 digits.');
  });

  it('verifies the code, hydrates the store, and navigates', async () => {
    setup();
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigateByUrl');
    page.form.setValue({ code: '123456' });
    await page.submit();
    expect(auth.verifyTwoFactor).toHaveBeenCalledWith('123456');
    expect(store.isAuthenticated()).toBe(true);
    expect(navigate).toHaveBeenCalled();
  });

  it('shows an error on an incorrect code', async () => {
    setup();
    auth.verifyTwoFactor.mockResolvedValue({
      ok: false,
      failure: { code: null, status: 401, message: '' },
    });
    page.form.setValue({ code: '000000' });
    await page.submit();
    expect(page.error()).toContain('incorrect or expired');
    expect(store.isAuthenticated()).toBe(false);
  });

  it('shows a rate-limit message on 429', async () => {
    setup();
    auth.verifyTwoFactor.mockResolvedValue({
      ok: false,
      failure: { code: null, status: 429, message: '' },
    });
    page.form.setValue({ code: '000000' });
    await page.submit();
    expect(page.error()).toContain('Too many attempts');
  });

  it('errors when the session cannot be resolved after a verified code', async () => {
    setup();
    auth.getSession.mockResolvedValue(null);
    page.form.setValue({ code: '123456' });
    await page.submit();
    expect(store.isAuthenticated()).toBe(false);
    expect(page.error()).not.toBeNull();
  });

  it('has no axe violations', async () => {
    setup();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });
});
