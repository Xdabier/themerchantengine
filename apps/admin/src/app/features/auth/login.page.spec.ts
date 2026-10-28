import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { AuthService } from '@admin-services';
import type { AdminSessionUser } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE, DEMO_LOGIN, type DemoLogin } from '../../core/tokens';
import { LoginPage } from './login.page';

expect.extend(toHaveNoViolations);

const adminUser: AdminSessionUser = {
  id: 'a4f5c9a4-1a1a-4a4a-8a8a-aaaaaaaaaaaa',
  email: 'admin@merchants.test',
  roles: [],
  permissions: [],
  status: 'active',
  role: 'ADMIN',
};

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  let page: LoginPage;
  let store: AuthStore;
  let auth: {
    signIn: jest.Mock;
    getSession: jest.Mock;
    sendMagicLink: jest.Mock;
    resendVerificationEmail: jest.Mock;
  };

  const flush = () => new Promise((r) => setTimeout(r, 0));

  /**
   * Drive a value through the real CVA path — set the native input and dispatch
   * an `input` event so `app-input.handleInput` -> `onChange` updates the
   * FormControl exactly as a user keystroke does. `form.setValue()` bypasses
   * this path and would not have surfaced the memoized-computed bug.
   */
  function typeInto(selector: string, value: string): void {
    const el = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const submitButton = () =>
    fixture.nativeElement.querySelector('[data-testid="login-submit"] button') as HTMLButtonElement;

  function setup(params: Record<string, string> = {}, demoLogin: DemoLogin | null = null): void {
    auth = {
      signIn: jest.fn(() => Promise.resolve({ status: 'authenticated' })),
      getSession: jest.fn(() => Promise.resolve(adminUser)),
      sendMagicLink: jest.fn(() => Promise.resolve({ ok: true })),
      resendVerificationEmail: jest.fn(() => Promise.resolve({ ok: true })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: DEMO_LOGIN, useValue: demoLogin },
        { provide: AuthService, useValue: auth },
        {
          provide: ActivatedRoute,
          useValue: { queryParams: new BehaviorSubject<Record<string, string>>(params) },
        },
      ],
    });
    store = TestBed.inject(AuthStore);
    fixture = TestBed.createComponent(LoginPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('keeps submit disabled while the form is pristine', () => {
    setup();
    expect(page.submitDisabled()).toBe(true);
    expect(submitButton().disabled).toBe(true);
  });

  it('enables the rendered submit button once valid credentials are typed', () => {
    setup();
    expect(submitButton().disabled).toBe(true);

    typeInto('input#login-email', 'admin@merchants.test');
    typeInto('input#login-password', 'password123');
    fixture.detectChanges();

    expect(page.submitDisabled()).toBe(false);
    expect(submitButton().disabled).toBe(false);
  });

  it('enables the rendered submit button on a valid email alone in magic-link mode', () => {
    setup();
    page.toggleMode();
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(true);

    typeInto('input#login-email', 'admin@merchants.test');
    fixture.detectChanges();

    expect(submitButton().disabled).toBe(false);
  });

  it('shows the email validator error after touch', () => {
    setup();
    page.form.controls.email.setValue('not-an-email');
    page.form.controls.email.markAsTouched();
    expect(page.emailError()).toBe('Enter a valid email address.');
  });

  it('shows the email required error after touch', () => {
    setup();
    page.form.controls.email.markAsTouched();
    expect(page.emailError()).toBe('Email is required.');
  });

  it('shows the password required error after touch', () => {
    setup();
    page.form.controls.password.markAsTouched();
    expect(page.passwordError()).toBe('Password is required.');
  });

  it('signs in, hydrates the store, and navigates', async () => {
    setup();
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigateByUrl');
    page.form.setValue({ email: 'admin@merchants.test', password: 'password123' });
    page.submit();
    await flush();
    expect(auth.signIn).toHaveBeenCalled();
    expect(store.isAuthenticated()).toBe(true);
    expect(navigate).toHaveBeenCalled();
  });

  it('routes to the 2FA challenge when sign-in needs two-factor', async () => {
    setup();
    auth.signIn.mockResolvedValue({ status: 'two-factor-required' });
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate');
    page.form.setValue({ email: 'a@b.co', password: 'pw' });
    page.submit();
    await flush();
    expect(navigate).toHaveBeenCalledWith(['/auth/two-factor'], expect.anything());
    expect(store.isAuthenticated()).toBe(false);
  });

  it('shows a generic message on a failed sign-in', async () => {
    setup();
    auth.signIn.mockResolvedValue({
      status: 'failed',
      failure: { code: null, status: 401, message: 'no' },
    });
    page.form.setValue({ email: 'a@b.co', password: 'pw' });
    page.submit();
    await flush();
    expect(page.error()).toBe('Incorrect email or password.');
  });

  it('shows a rate-limit message on a 429', async () => {
    setup();
    auth.signIn.mockResolvedValue({
      status: 'failed',
      failure: { code: null, status: 429, message: 'slow' },
    });
    page.form.setValue({ email: 'a@b.co', password: 'pw' });
    page.submit();
    await flush();
    expect(page.error()).toContain('Too many attempts');
  });

  it('shows a generic retry message on a network failure (status 0)', async () => {
    setup();
    auth.signIn.mockResolvedValue({
      status: 'failed',
      failure: { code: null, status: 0, message: 'network down' },
    });
    page.form.setValue({ email: 'a@b.co', password: 'pw' });
    page.submit();
    await flush();
    expect(page.error()).toBe('Sign-in failed. Please try again.');
  });

  it('shows a generic retry message on a server error (status 500)', async () => {
    setup();
    auth.signIn.mockResolvedValue({
      status: 'failed',
      failure: { code: null, status: 500, message: 'boom' },
    });
    page.form.setValue({ email: 'a@b.co', password: 'pw' });
    page.submit();
    await flush();
    expect(page.error()).toBe('Sign-in failed. Please try again.');
  });

  it('fails when sign-in succeeds but the session cannot be resolved', async () => {
    setup();
    auth.getSession.mockResolvedValue(null);
    page.form.setValue({ email: 'admin@merchants.test', password: 'password123' });
    page.submit();
    await flush();
    expect(page.error()).toBe('Sign-in failed. Please try again.');
    expect(store.isAuthenticated()).toBe(false);
  });

  it('blocks a deactivated account after a successful sign-in', async () => {
    setup();
    auth.getSession.mockResolvedValue({ ...adminUser, status: 'inactive' });
    page.form.setValue({ email: 'admin@merchants.test', password: 'password123' });
    page.submit();
    await flush();
    expect(page.error()).toContain('deactivated');
    expect(store.isAuthenticated()).toBe(false);
  });

  /**
   * Finding AD6 / AD11. A customer whose credentials work signs in fine here:
   * the session resolves, the store commits, and the shell renders with their
   * name on it. The error has to be specific, because a generic "Sign-in
   * failed" after correct credentials is a lie.
   */
  it('refuses a CUSTOMER account with a dedicated no-access message', async () => {
    setup();
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigateByUrl');
    auth.getSession.mockResolvedValue({ ...adminUser, role: 'CUSTOMER' });
    page.form.setValue({ email: 'customer@demo.example', password: 'password123' });
    page.submit();
    await flush();
    expect(page.error()).toBe('This account does not have access to the admin dashboard.');
    expect(store.isAuthenticated()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SUPPORT'] as const)(
    'still signs a %s in unchanged',
    async (role) => {
      setup();
      auth.getSession.mockResolvedValue({ ...adminUser, role });
      page.form.setValue({ email: 'staff@merchants.test', password: 'password123' });
      page.submit();
      await flush();
      expect(page.error()).toBeNull();
      expect(store.isAuthenticated()).toBe(true);
    },
  );

  it('offers a resend when the account email is not verified', async () => {
    setup();
    auth.signIn.mockResolvedValue({
      status: 'failed',
      failure: { code: 'EMAIL_NOT_VERIFIED', status: 403, message: '' },
    });
    page.form.setValue({ email: 'a@b.co', password: 'pw' });
    page.submit();
    await flush();
    expect(page.unverifiedEmail()).toBe('a@b.co');
    await page.resendVerification();
    expect(auth.resendVerificationEmail).toHaveBeenCalledWith('a@b.co');
    expect(page.notice()).toContain('Verification email sent');
  });

  it('shows the session-expired banner when reason=session-expired', () => {
    setup({ reason: 'session-expired' });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="login-session-expired"]'),
    ).not.toBeNull();
  });

  it('sends a magic link in magic-link mode', async () => {
    setup();
    page.toggleMode();
    expect(page.mode()).toBe('magic-link');
    page.form.controls.email.setValue('a@b.co');
    page.submit();
    await flush();
    expect(auth.sendMagicLink).toHaveBeenCalledWith({ email: 'a@b.co' });
    expect(page.notice()).toContain('sign-in link');
  });

  it('shows a rate-limit message when the magic link is throttled', async () => {
    setup();
    auth.sendMagicLink.mockResolvedValue({
      ok: false,
      failure: { code: null, status: 429, message: '' },
    });
    page.toggleMode();
    page.form.controls.email.setValue('a@b.co');
    page.submit();
    await flush();
    expect(page.error()).toContain('Too many requests');
  });

  it('shows a generic message when the magic link fails for another reason', async () => {
    setup();
    auth.sendMagicLink.mockResolvedValue({
      ok: false,
      failure: { code: null, status: 500, message: '' },
    });
    page.toggleMode();
    page.form.controls.email.setValue('a@b.co');
    page.submit();
    await flush();
    expect(page.error()).toBe('Could not send the sign-in link. Please try again.');
  });

  it('surfaces an error when the verification resend fails', async () => {
    setup();
    auth.signIn.mockResolvedValue({
      status: 'failed',
      failure: { code: 'EMAIL_NOT_VERIFIED', status: 403, message: '' },
    });
    page.form.setValue({ email: 'a@b.co', password: 'pw' });
    page.submit();
    await flush();
    expect(page.unverifiedEmail()).toBe('a@b.co');
    auth.resendVerificationEmail.mockResolvedValue({
      ok: false,
      failure: { code: null, status: 500, message: '' },
    });
    await page.resendVerification();
    expect(page.error()).toContain('Could not resend');
  });

  it('sanitises open-redirect attempts in returnTo', () => {
    setup();
    const p = page as unknown as { safeReturnTo: (v: string | null) => string };
    expect(p.safeReturnTo('//evil.example/path')).toBe('/');
    expect(p.safeReturnTo('javascript:alert(1)')).toBe('/');
    expect(p.safeReturnTo('/orders')).toBe('/orders');
    expect(p.safeReturnTo(null)).toBe('/');
    expect(p.safeReturnTo('/\\evil')).toBe('/');
    expect(p.safeReturnTo('/foo\\bar')).toBe('/');
  });

  it('has no axe violations', async () => {
    setup();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in the error state', async () => {
    setup();
    auth.signIn.mockResolvedValue({
      status: 'failed',
      failure: { code: null, status: 401, message: 'no' },
    });
    page.form.setValue({ email: 'a@b.co', password: 'pw' });
    page.submit();
    await flush();
    fixture.detectChanges();
    expect(page.error()).not.toBeNull();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations with the session-expired banner', async () => {
    setup({ reason: 'session-expired' });
    fixture.detectChanges();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in magic-link mode', async () => {
    setup();
    page.toggleMode();
    fixture.detectChanges();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });

  describe('demo login', () => {
    const demo: DemoLogin = { email: 'demo@example.test', password: 'demo-pass' };
    const banner = () =>
      fixture.nativeElement.querySelector('[data-testid="login-demo"]') as HTMLElement | null;

    it('hides the demo banner on a normal build', () => {
      setup();
      expect(banner()).toBeNull();
    });

    it('shows the demo credentials and the nightly reset notice', () => {
      setup({}, demo);
      const text = banner()?.textContent ?? '';
      expect(text).toContain(demo.email);
      expect(text).toContain(demo.password);
      expect(text).toContain('resets every night');
    });

    it('fills the form and enables submit from the demo button', () => {
      setup({}, demo);
      const fill = fixture.nativeElement.querySelector(
        'button[data-testid="login-demo-fill"]',
      ) as HTMLButtonElement;
      fill.click();
      fixture.detectChanges();
      expect(page.form.getRawValue()).toEqual(demo);
      expect(submitButton().disabled).toBe(false);
    });

    it('has no axe violations with the demo banner', async () => {
      setup({}, demo);
      const results = await axe(fixture.nativeElement as Element);
      expect(results).toHaveNoViolations();
    });
  });
});
