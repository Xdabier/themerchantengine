import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LicenseService, type LicenseVerdict } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { LicenseBannerComponent } from './license-banner.component';

expect.extend(toHaveNoViolations);

function verdict(overrides: Partial<LicenseVerdict> = {}): LicenseVerdict {
  return {
    status: 'valid',
    claims: {
      id: 'lic-1',
      licensee: 'Demo Agency',
      plan: 'studio',
      storeCap: 5,
      domains: ['example.com'],
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
    },
    reason: null,
    verifiedAt: '2026-09-05T00:00:00.000Z',
    graceEndsAt: null,
    daysToExpiry: 118,
    ...overrides,
  } as LicenseVerdict;
}

/**
 * Plan E3.5.2. The banner exists to tell an operator that a deadline is
 * coming. What it must not do is imply a consequence the engine does not
 * carry out: DR-31 holds that an expired license shows a banner and cuts
 * nothing off.
 */
describe('LicenseBannerComponent', () => {
  let fixture: ComponentFixture<LicenseBannerComponent>;
  let banner: LicenseBannerComponent;
  let currentSpy: jest.Mock;

  function configure(perms: string[] = ['license:view']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: LicenseService, useValue: { current: currentSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(LicenseBannerComponent);
    banner = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    sessionStorage.clear();
    currentSpy = jest.fn(() => of(verdict()));
  });

  it('says nothing while the license is valid', () => {
    configure();

    expect(banner.visible()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="license-banner"]')).toBeNull();
  });

  it.each([['expiring'], ['grace'], ['expired'], ['invalid'], ['missing']])(
    'shows for the %s verdict',
    (status) => {
      currentSpy = jest.fn(() => of(verdict({ status: status as LicenseVerdict['status'] })));
      configure();

      expect(banner.visible()).toBe(true);
    },
  );

  it('counts the days down while the license is only expiring', () => {
    currentSpy = jest.fn(() => of(verdict({ status: 'expiring', daysToExpiry: 9 })));
    configure();

    expect(banner.message()).toContain('9 day(s)');
    expect(banner.tone()).toBe('warning');
  });

  it('never claims a consequence the engine does not carry out', () => {
    currentSpy = jest.fn(() => of(verdict({ status: 'expired', daysToExpiry: -60 })));
    configure();
    const message = banner.message().toLowerCase();

    expect(message).toContain('nothing has been switched off');
    expect(message).not.toContain('suspended');
    expect(message).not.toContain('will be disabled');
  });

  it('carries the engine reason when the file did not verify', () => {
    currentSpy = jest.fn(() =>
      of(verdict({ status: 'invalid', claims: null, reason: 'signature does not verify' })),
    );
    configure();

    expect(banner.message()).toContain('signature does not verify');
  });

  it('dismisses for this session and not for the install', () => {
    currentSpy = jest.fn(() => of(verdict({ status: 'expiring', daysToExpiry: 9 })));
    configure();
    banner.dismiss();

    expect(banner.visible()).toBe(false);
    expect(sessionStorage.getItem('admin.license-banner.dismissed')).toBe('1');
    // sessionStorage, not localStorage: a new session sees it again, which is
    // the point of a banner about a deadline.
    expect(localStorage.getItem('admin.license-banner.dismissed')).toBeNull();
  });

  it('never asks for a verdict it has no permission to read', () => {
    configure([]);

    expect(currentSpy).not.toHaveBeenCalled();
    expect(banner.visible()).toBe(false);
  });

  it('renders nothing when the status read fails', () => {
    currentSpy = jest.fn(() => throwError(() => new Error('boom')));
    configure();

    expect(banner.visible()).toBe(false);
  });

  it('has no axe violations', async () => {
    currentSpy = jest.fn(() => of(verdict({ status: 'expiring', daysToExpiry: 9 })));
    configure();

    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });
});
