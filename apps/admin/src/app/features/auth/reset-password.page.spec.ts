import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { AuthService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject } from 'rxjs';
import { ResetPasswordPage } from './reset-password.page';

expect.extend(toHaveNoViolations);

describe('ResetPasswordPage', () => {
  let fixture: ComponentFixture<ResetPasswordPage>;
  let page: ResetPasswordPage;
  let auth: { resetPassword: jest.Mock };

  function setup(params: Record<string, string> = { token: 'tok-123' }): void {
    auth = { resetPassword: jest.fn(() => Promise.resolve({ ok: true })) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: { queryParams: new BehaviorSubject(params) } },
      ],
    });
    fixture = TestBed.createComponent(ResetPasswordPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('shows the missing-token state when no token is in the URL', () => {
    setup({});
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="reset-missing-token"]'),
    ).not.toBeNull();
  });

  it('flags a password / confirm mismatch', () => {
    setup();
    page.form.setValue({ password: 'Abcdefg1', confirm: 'Abcdefg2' });
    page.form.controls.confirm.markAsTouched();
    expect(page.confirmError()).toBe('Passwords do not match.');
  });

  it('flags the confirm-required branch', () => {
    setup();
    page.form.controls.confirm.markAsTouched();
    expect(page.confirmError()).toBe('Confirm your new password.');
  });

  it('rejects a weak password', () => {
    setup();
    page.form.controls.password.setValue('weak');
    page.form.controls.password.markAsTouched();
    expect(page.passwordError()).not.toBeNull();
  });

  it('updates the password, shows success, and redirects to login', async () => {
    jest.useFakeTimers();
    try {
      setup();
      const navigate = jest.spyOn(TestBed.inject(Router), 'navigate');
      page.form.setValue({ password: 'Abcdefg1', confirm: 'Abcdefg1' });
      await page.submit();
      expect(page.done()).toBe(true);
      expect(auth.resetPassword).toHaveBeenCalledWith({ token: 'tok-123', password: 'Abcdefg1' });
      jest.advanceTimersByTime(2600);
      expect(navigate).toHaveBeenCalledWith(['/auth/login']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows the invalid-link message on a failure', async () => {
    setup();
    auth.resetPassword.mockResolvedValue({
      ok: false,
      failure: { code: null, status: 400, message: '' },
    });
    page.form.setValue({ password: 'Abcdefg1', confirm: 'Abcdefg1' });
    await page.submit();
    expect(page.error()).toContain('invalid or expired');
  });

  it('shows a rate-limit message on 429', async () => {
    setup();
    auth.resetPassword.mockResolvedValue({
      ok: false,
      failure: { code: null, status: 429, message: '' },
    });
    page.form.setValue({ password: 'Abcdefg1', confirm: 'Abcdefg1' });
    await page.submit();
    expect(page.error()).toContain('Too many attempts');
  });

  it('has no axe violations', async () => {
    setup();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in the success state', async () => {
    jest.useFakeTimers();
    try {
      setup();
      page.form.setValue({ password: 'Abcdefg1', confirm: 'Abcdefg1' });
      await page.submit();
      expect(page.done()).toBe(true);
    } finally {
      jest.useRealTimers();
    }
    fixture.detectChanges();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });
});
