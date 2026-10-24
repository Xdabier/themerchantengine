import { ApiForbiddenError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SettingsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { SettingsDomainsPage } from './settings-domains.page';

expect.extend(toHaveNoViolations);

const fixture = {
  general: {},
  domains: {
    storefront: 'https://shop.example.com',
    admin: '',
    api: '',
  },
};

/**
 * Plan E3.1.6. The domains group had no editor, and its empty value is a
 * setting rather than a gap: empty means the engine reads the environment
 * variable instead. A screen that does not say so is a screen an operator
 * fills in wrongly once and never revisits.
 */
describe('SettingsDomainsPage', () => {
  let component: ComponentFixture<SettingsDomainsPage>;
  let page: SettingsDomainsPage;
  let getSpy: jest.Mock;
  let updateSpy: jest.Mock;

  function configure(perms: string[] = ['settings:view', 'settings:manage']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: SettingsService, useValue: { getAll: getSpy, update: updateSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    component = TestBed.createComponent(SettingsDomainsPage);
    page = component.componentInstance;
    component.detectChanges();
  }

  beforeEach(() => {
    getSpy = jest.fn(() => of(fixture));
    updateSpy = jest.fn((body: Record<string, unknown>) => of({ ...fixture, ...body }));
  });

  it('seeds every origin from the domains group', () => {
    configure();

    expect(page.form.controls.storefront.value).toBe('https://shop.example.com');
    expect(page.form.controls.admin.value).toBe('');
  });

  it('states the empty-means-the-environment rule on the screen', () => {
    configure();
    const rule = component.nativeElement.querySelector(
      '[data-testid="settings-domains-empty-rule"]',
    ) as HTMLElement;

    expect(rule.textContent).toContain('environment variable');
  });

  it('names the environment variable each field falls back to', () => {
    configure();

    expect(component.nativeElement.textContent).toContain('SITE_URL');
    expect(component.nativeElement.textContent).toContain('ADMIN_PUBLIC_BASE_URL');
    expect(component.nativeElement.textContent).toContain('API_PUBLIC_BASE_URL');
  });

  it('sends only the origins that changed', () => {
    configure();
    page.form.controls.admin.setValue('https://admin.example.com');
    page.form.controls.admin.markAsDirty();
    page.form.markAsDirty();
    page.save();

    expect(updateSpy).toHaveBeenCalledWith({ admin: 'https://admin.example.com' });
  });

  it('accepts an empty value, which is how a field falls back', () => {
    configure();
    page.form.controls.storefront.setValue('');
    page.form.controls.storefront.markAsDirty();
    page.form.controls.storefront.markAsTouched();
    page.form.markAsDirty();
    page.save();

    expect(page.originError('storefront')).toBeNull();
    expect(updateSpy).toHaveBeenCalledWith({ storefront: '' });
  });

  it('refuses a plain http origin', () => {
    configure();
    page.form.controls.api.setValue('http://api.example.com');
    page.form.controls.api.markAsDirty();
    page.form.markAsDirty();
    page.save();

    expect(updateSpy).not.toHaveBeenCalled();
    expect(page.originError('api')).toContain('https://');
  });

  it('refuses an origin carrying a path', () => {
    configure();
    page.form.controls.api.setValue('https://api.example.com/v1');
    page.form.controls.api.markAsDirty();
    page.form.markAsDirty();
    page.save();

    expect(updateSpy).not.toHaveBeenCalled();
    expect(page.originError('api')).toContain('no path');
  });

  it('surfaces ApiForbiddenError as a permission-safe message', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure(['settings:view']);

    expect(page.error()).toContain('permission');
  });

  it('has no axe violations', async () => {
    configure();

    expect(await axe(component.nativeElement)).toHaveNoViolations();
  });
});
