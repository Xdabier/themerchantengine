import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SettingsService, updateSettingsRequestSchema } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { SettingsAppearancePage } from './settings-appearance.page';

expect.extend(toHaveNoViolations);

const fixture = {
  appearance: {
    logoUrl: 'https://cdn.example.com/logo.png',
    faviconUrl: '',
  },
};

describe('SettingsAppearancePage', () => {
  let component: ComponentFixture<SettingsAppearancePage>;
  let page: SettingsAppearancePage;
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
    component = TestBed.createComponent(SettingsAppearancePage);
    page = component.componentInstance;
    component.detectChanges();
  }

  beforeEach(() => {
    getSpy = jest.fn(() => of(fixture));
    updateSpy = jest.fn((body: Record<string, unknown>) =>
      of({ appearance: { ...fixture.appearance, ...body } }),
    );
  });

  it('seeds the form from settings', () => {
    configure();
    expect(page.form.controls.logoUrl.value).toBe('https://cdn.example.com/logo.png');
  });

  it('urlError flags malformed urls', () => {
    configure();
    page.form.controls.logoUrl.setValue('nope');
    page.form.controls.logoUrl.markAsTouched();
    expect(page.urlError('logoUrl')).toContain('full URL');
  });

  it('clears an empty URL field with an empty string, not null', () => {
    // `StoreSetting.value` is a non-nullable Json column, and every other
    // cleared string setting is stored as ''. A null would need JsonNull
    // handling no other key has, and this PATCH never reached the API to prove
    // it either way: the request schema had no logoUrl key, so Zod stripped
    // the body and the API answered 200 with nothing changed.
    configure();
    page.form.controls.logoUrl.setValue('');
    page.form.controls.logoUrl.markAsDirty();
    page.save();
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ logoUrl: '' }));
  });

  it('sends the logo URL under a key the request schema keeps', () => {
    // The regression this closes: the page reported "saved" for a value the
    // schema stripped before it ever left the browser.
    configure();
    page.form.controls.logoUrl.setValue('https://cdn.demo.example/logo.png');
    page.form.controls.logoUrl.markAsDirty();
    page.save();
    const body = updateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(updateSettingsRequestSchema.parse(body)).toEqual({
      logoUrl: 'https://cdn.demo.example/logo.png',
    });
  });

  it('ApiForbiddenError surfaces a permission-safe error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('ApiNotFoundError surfaces the appearance-settings-not-found error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Appearance settings not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(component.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
