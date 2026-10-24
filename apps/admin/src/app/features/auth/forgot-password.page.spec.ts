import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ForgotPasswordPage } from './forgot-password.page';

expect.extend(toHaveNoViolations);

describe('ForgotPasswordPage', () => {
  let fixture: ComponentFixture<ForgotPasswordPage>;
  let page: ForgotPasswordPage;
  let auth: { requestPasswordReset: jest.Mock };

  function setup(): void {
    auth = { requestPasswordReset: jest.fn(() => Promise.resolve({ ok: true })) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: AuthService, useValue: auth },
      ],
    });
    fixture = TestBed.createComponent(ForgotPasswordPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('shows an error for an invalid email', () => {
    setup();
    page.form.controls.email.setValue('nope');
    page.form.controls.email.markAsTouched();
    expect(page.emailError()).toBe('Enter a valid email address.');
  });

  it('shows the email required error after touch', () => {
    setup();
    page.form.controls.email.markAsTouched();
    expect(page.emailError()).toBe('Email is required.');
  });

  it('shows the enumeration-safe success state on success', async () => {
    setup();
    page.form.setValue({ email: 'a@b.co' });
    await page.submit();
    expect(page.done()).toBe(true);
    expect(auth.requestPasswordReset).toHaveBeenCalledWith({ email: 'a@b.co' });
  });

  it('surfaces a retry message on 429', async () => {
    setup();
    auth.requestPasswordReset.mockResolvedValue({
      ok: false,
      failure: { code: null, status: 429, message: '' },
    });
    page.form.setValue({ email: 'a@b.co' });
    await page.submit();
    expect(page.error()).toContain('Too many requests');
    expect(page.done()).toBe(false);
  });

  it('shows a generic message on other failures', async () => {
    setup();
    auth.requestPasswordReset.mockResolvedValue({
      ok: false,
      failure: { code: null, status: 500, message: '' },
    });
    page.form.setValue({ email: 'a@b.co' });
    await page.submit();
    expect(page.error()).toBe('Could not send reset link. Please try again.');
  });

  it('has no axe violations', async () => {
    setup();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });
});
