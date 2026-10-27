import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '@admin-services';
import type { AdminUser } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { TwoFactorSetupPage } from './two-factor-setup.page';

expect.extend(toHaveNoViolations);

const baseUser: AdminUser = {
  id: 'a4f5c9a4-1a1a-4a4a-8a8a-aaaaaaaaaaaa',
  email: 'admin@merchants.test',
  roles: [],
  permissions: [],
  status: 'active',
};

const TOTP_URI =
  'otpauth://totp/Merchants%20Engine:admin@merchants.test?secret=ABCDEFGH&issuer=Merchants';

describe('TwoFactorSetupPage', () => {
  let fixture: ComponentFixture<TwoFactorSetupPage>;
  let page: TwoFactorSetupPage;
  let auth: {
    enableTwoFactor: jest.Mock;
    confirmTwoFactor: jest.Mock;
    disableTwoFactor: jest.Mock;
    getSession: jest.Mock;
  };

  function setup(twoFactorEnabled: boolean): void {
    auth = {
      enableTwoFactor: jest.fn(() =>
        Promise.resolve({ ok: true, totpUri: TOTP_URI, backupCodes: ['b1', 'b2'] }),
      ),
      confirmTwoFactor: jest.fn(() => Promise.resolve({ ok: true })),
      disableTwoFactor: jest.fn(() => Promise.resolve({ ok: true })),
      getSession: jest.fn(() => Promise.resolve(baseUser)),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: AuthService, useValue: auth },
      ],
    });
    TestBed.inject(AuthStore).setSession({ user: { ...baseUser, twoFactorEnabled } });
    fixture = TestBed.createComponent(TwoFactorSetupPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('starts in the start view when 2FA is off', () => {
    setup(false);
    expect(page.view()).toBe('start');
  });

  it('starts in the enabled view when 2FA is already on', () => {
    setup(true);
    expect(page.view()).toBe('enabled');
  });

  it('moves to the enrolling view and surfaces the secret on enable', async () => {
    setup(false);
    page.enableForm.setValue({ password: 'pw' });
    await page.enable();
    expect(page.view()).toBe('enrolling');
    expect(page.secret()).toBe('ABCDEFGH');
    expect(page.backupCodes()).toEqual(['b1', 'b2']);
  });

  it('shows an error when enable is rejected', async () => {
    setup(false);
    auth.enableTwoFactor.mockResolvedValue({
      ok: false,
      failure: { code: null, status: 401, message: '' },
    });
    page.enableForm.setValue({ password: 'wrong' });
    await page.enable();
    expect(page.view()).toBe('start');
    expect(page.error()).not.toBeNull();
  });

  it('flags a non-6-digit confirmation code', async () => {
    setup(false);
    page.enableForm.setValue({ password: 'pw' });
    await page.enable();
    page.confirmForm.controls.code.setValue('12');
    page.confirmForm.controls.code.markAsTouched();
    expect(page.codeError()).toBe('The code is 6 digits.');
  });

  it('flags the missing confirmation code after touch', async () => {
    setup(false);
    page.enableForm.setValue({ password: 'pw' });
    await page.enable();
    page.confirmForm.controls.code.markAsTouched();
    expect(page.codeError()).toBe('Enter the code from your authenticator app.');
  });

  it('flags the missing enable password after touch', () => {
    setup(false);
    page.enableForm.controls.password.markAsTouched();
    expect(page.enablePasswordError()).toBe('Enter your current password.');
  });

  it('flags the missing disable password after touch', () => {
    setup(true);
    page.disableForm.controls.password.markAsTouched();
    expect(page.disablePasswordError()).toBe('Enter your current password.');
  });

  it('shows a rate-limit message when confirmation is throttled', async () => {
    setup(false);
    page.enableForm.setValue({ password: 'pw' });
    await page.enable();
    auth.confirmTwoFactor.mockResolvedValue({ ok: false, failure: { status: 429 } });
    page.confirmForm.setValue({ code: '123456' });
    await page.confirm();
    expect(page.error()).toContain('Too many attempts');
    expect(page.view()).toBe('enrolling');
  });

  it('shows an incorrect-or-expired message on a non-429 confirmation failure', async () => {
    setup(false);
    page.enableForm.setValue({ password: 'pw' });
    await page.enable();
    auth.confirmTwoFactor.mockResolvedValue({ ok: false, failure: { status: 400 } });
    page.confirmForm.setValue({ code: '123456' });
    await page.confirm();
    expect(page.error()).toContain('incorrect or expired');
    expect(page.view()).toBe('enrolling');
  });

  it('keeps the enabled view and warns on a wrong password when disable fails', async () => {
    setup(true);
    auth.disableTwoFactor.mockResolvedValue({ ok: false, failure: { status: 401 } });
    page.disableForm.setValue({ password: 'wrong' });
    await page.disable();
    expect(page.error()).toContain('password is incorrect');
    expect(page.view()).toBe('enabled');
  });

  it('confirms enrolment and moves to the done view', async () => {
    setup(false);
    page.enableForm.setValue({ password: 'pw' });
    await page.enable();
    page.confirmForm.setValue({ code: '123456' });
    await page.confirm();
    expect(auth.confirmTwoFactor).toHaveBeenCalledWith('123456');
    expect(page.view()).toBe('done');
  });

  it('disables 2FA and returns to the start view', async () => {
    setup(true);
    page.disableForm.setValue({ password: 'pw' });
    await page.disable();
    expect(auth.disableTwoFactor).toHaveBeenCalledWith('pw');
    expect(page.view()).toBe('start');
  });

  it('has no axe violations', async () => {
    setup(false);
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in the enrolling view', async () => {
    setup(false);
    page.enableForm.setValue({ password: 'pw' });
    await page.enable();
    fixture.detectChanges();
    expect(page.view()).toBe('enrolling');
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in the enabled view', async () => {
    setup(true);
    expect(page.view()).toBe('enabled');
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in the done view', async () => {
    setup(false);
    page.enableForm.setValue({ password: 'pw' });
    await page.enable();
    page.confirmForm.setValue({ code: '123456' });
    await page.confirm();
    fixture.detectChanges();
    expect(page.view()).toBe('done');
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });
});
