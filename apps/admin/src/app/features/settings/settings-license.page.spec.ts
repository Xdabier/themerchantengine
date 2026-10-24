import { ApiError, ApiForbiddenError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LicenseService, type LicenseVerdict } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';
import { SettingsLicensePage } from './settings-license.page';

expect.extend(toHaveNoViolations);

const CLAIMS = {
  id: 'lic-1',
  licensee: 'Demo Agency',
  plan: 'studio',
  storeCap: 5,
  domains: ['example.com', 'admin.example.com'],
  issuedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
};

function verdict(overrides: Partial<LicenseVerdict> = {}): LicenseVerdict {
  return {
    status: 'valid',
    claims: CLAIMS,
    reason: null,
    verifiedAt: '2026-09-05T00:00:00.000Z',
    graceEndsAt: null,
    daysToExpiry: 118,
    ...overrides,
  } as LicenseVerdict;
}

/**
 * Plan E3.5.3 and E3.5.5. The page reports the verdict and lets an operator
 * replace the file. Two things it must never do: claim that anything has been
 * switched off, since nothing has, and swallow the engine's refusal reason,
 * since that reason is the only thing that distinguishes a wrong key from a
 * wrong domain from an expired file.
 */
describe('SettingsLicensePage', () => {
  let component: ComponentFixture<SettingsLicensePage>;
  let page: SettingsLicensePage;
  let currentSpy: jest.Mock;
  let installSpy: jest.Mock;

  function configure(perms: string[] = ['license:view', 'license:manage']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        provideStoreSettingsStub(),
        { provide: LicenseService, useValue: { current: currentSpy, install: installSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    component = TestBed.createComponent(SettingsLicensePage);
    page = component.componentInstance;
    component.detectChanges();
  }

  beforeEach(() => {
    currentSpy = jest.fn(() => of(verdict()));
    installSpy = jest.fn(() => of(verdict()));
  });

  it('shows the plan, the licensee and the bound domains', () => {
    configure();
    const text = component.nativeElement.textContent as string;

    expect(text).toContain('Demo Agency');
    expect(text).toContain('studio');
    expect(text).toContain('example.com, admin.example.com');
  });

  it('reads the boot verdict rather than forcing a re-verify', () => {
    configure();

    expect(currentSpy).toHaveBeenCalledWith(false);
  });

  it('re-verifies the file on demand', () => {
    configure();
    page.reverify();

    expect(currentSpy).toHaveBeenLastCalledWith(true);
  });

  it.each([
    ['valid', 'Valid', 'success'],
    ['expiring', 'Expiring', 'warning'],
    ['grace', 'In grace period', 'warning'],
    ['expired', 'Expired', 'error'],
    ['invalid', 'Invalid', 'error'],
    ['missing', 'Not installed', 'error'],
  ])('names the %s status and gives it a tone', (status, label, tone) => {
    currentSpy = jest.fn(() => of(verdict({ status: status as LicenseVerdict['status'] })));
    configure();

    expect(page.statusLabel()).toBe(label);
    expect(page.badgeTone()).toBe(tone);
  });

  it('shows the reason an invalid verdict carries', () => {
    currentSpy = jest.fn(() =>
      of(
        verdict({
          status: 'invalid',
          claims: null,
          reason: 'license signature does not verify against the engine key',
          daysToExpiry: null,
        }),
      ),
    );
    configure();

    expect(component.nativeElement.textContent).toContain('does not verify');
  });

  it('says how long is left, and how long has passed once it is not', () => {
    configure();
    expect(page.expiryPhrase()).toBe('in 118 day(s)');

    currentSpy = jest.fn(() => of(verdict({ status: 'expired', daysToExpiry: -12 })));
    TestBed.resetTestingModule();
    configure();
    expect(page.expiryPhrase()).toBe('12 day(s) ago');
  });

  it('hides the replace control from an operator who can only read', () => {
    configure(['license:view']);

    expect(
      component.nativeElement.querySelector('[data-testid="settings-license-upload"]'),
    ).toBeNull();
  });

  it('sends the chosen file and adopts the verdict it comes back with', () => {
    configure();
    const file = new File(['{}'], 'engine.license.json', { type: 'application/json' });
    page.selected.set(file);
    installSpy = jest.fn(() => of(verdict({ status: 'expiring', daysToExpiry: 9 })));
    TestBed.resetTestingModule();
    configure();
    page.selected.set(file);
    page.upload();

    expect(installSpy).toHaveBeenCalledWith(file);
    expect(page.verdict()?.status).toBe('expiring');
    expect(page.notice()).toContain('installed');
  });

  it('renders the engine refusal reason rather than a generic failure', () => {
    installSpy = jest.fn(() =>
      throwError(
        () =>
          new ApiError({
            code: 'LICENSE_REFUSED',
            message: 'license is bound to other.example but this store answers on demo.example',
          }),
      ),
    );
    configure();
    page.selected.set(new File(['{}'], 'engine.license.json'));
    page.upload();

    expect(page.error()).toContain('bound to other.example');
  });

  it('does nothing when no file has been chosen', () => {
    configure();
    page.upload();

    expect(installSpy).not.toHaveBeenCalled();
  });

  it('surfaces ApiForbiddenError as a permission-safe message', () => {
    currentSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure(['license:view']);

    expect(page.error()).toContain('permission');
  });

  it('never claims that anything has been switched off', () => {
    // DR-31 and plan E1.5: the banner and this page are the whole consequence
    // of an expired license. Copy implying a cut-off would be a threat the
    // engine does not carry out.
    currentSpy = jest.fn(() => of(verdict({ status: 'expired', daysToExpiry: -60 })));
    configure();
    const text = (component.nativeElement.textContent as string).toLowerCase();

    expect(text).not.toContain('suspended');
    expect(text).not.toContain('disabled');
    expect(text).toContain('nothing here');
  });

  it('has no axe violations', async () => {
    configure();

    expect(await axe(component.nativeElement)).toHaveNoViolations();
  });
});
