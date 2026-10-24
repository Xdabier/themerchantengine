import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject } from 'rxjs';
import { VerifyEmailPage } from './verify-email.page';

expect.extend(toHaveNoViolations);

describe('VerifyEmailPage', () => {
  let fixture: ComponentFixture<VerifyEmailPage>;

  function setup(params: Record<string, string> = {}): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: ActivatedRoute, useValue: { queryParams: new BehaviorSubject(params) } },
      ],
    });
    fixture = TestBed.createComponent(VerifyEmailPage);
    fixture.detectChanges();
  }

  it('shows the success state when there is no error param', () => {
    setup();
    expect(fixture.componentInstance.verified()).toBe(true);
    expect(
      fixture.nativeElement.querySelector('[data-testid="verify-email-success"]'),
    ).not.toBeNull();
  });

  it('shows the failure state when an error param is present', () => {
    setup({ error: 'token_expired' });
    fixture.detectChanges();
    expect(fixture.componentInstance.verified()).toBe(false);
    expect(
      fixture.nativeElement.querySelector('[data-testid="verify-email-error"]'),
    ).not.toBeNull();
  });

  it('has no axe violations', async () => {
    setup();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in the failure state', async () => {
    setup({ error: 'token_expired' });
    fixture.detectChanges();
    expect(fixture.componentInstance.verified()).toBe(false);
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });
});
