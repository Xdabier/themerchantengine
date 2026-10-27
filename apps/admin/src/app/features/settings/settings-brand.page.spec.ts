import { Dialog } from '@angular/cdk/dialog';
import { ApiForbiddenError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SettingsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { SettingsBrandPage } from './settings-brand.page';

expect.extend(toHaveNoViolations);

const fixture = {
  general: {},
  brand: {
    baseColors: { primary: '#1F2937', secondary: null, accent: null },
    fontKit: 'latin-rounded',
    logoAssetId: null,
    faviconAssetId: null,
  },
};

/**
 * Plan E3.1.3. The brand group had no editor at all, so the colours the
 * storefront palette is generated from could only be set by a seed.
 *
 * The generator is the interesting part: this screen runs the same pure
 * function the storefront reads, on every change, so the preview is the
 * palette rather than a picture of one, and a palette the generator refuses
 * is refused here instead of being stored.
 */
describe('SettingsBrandPage', () => {
  let component: ComponentFixture<SettingsBrandPage>;
  let page: SettingsBrandPage;
  let getSpy: jest.Mock;
  let updateSpy: jest.Mock;
  let openSpy: jest.Mock;

  function configure(perms: string[] = ['settings:view', 'settings:manage']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: SettingsService, useValue: { getAll: getSpy, update: updateSpy } },
        { provide: Dialog, useValue: { open: openSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    component = TestBed.createComponent(SettingsBrandPage);
    page = component.componentInstance;
    component.detectChanges();
  }

  beforeEach(() => {
    getSpy = jest.fn(() => of(fixture));
    updateSpy = jest.fn((body: Record<string, unknown>) => of({ ...fixture, ...body }));
    openSpy = jest.fn();
  });

  it('seeds the colours, the kit and the marks from the brand group', () => {
    configure();

    expect(page.form.controls.primary.value).toBe('#1F2937');
    expect(page.form.controls.secondary.value).toBe('');
    expect(page.form.controls.fontKit.value).toBe('latin-rounded');
    expect(page.form.controls.logoAssetId.value).toBe('');
  });

  it('generates a full palette from the seeded colours', () => {
    configure();

    expect(page.palette()).not.toBeNull();
    expect(page.palette()?.tokens['--brand-primary']).toMatch(/^#[0-9a-f]{6}$/i);
    expect(page.paletteError()).toBeNull();
  });

  it('regenerates when the operator changes a colour', () => {
    configure();
    const before = page.palette()?.tokens['--brand-primary'];
    page.form.controls.primary.setValue('#8A2BE2');
    component.detectChanges();

    expect(page.palette()?.tokens['--brand-primary']).not.toBe(before);
  });

  it('reports the contrast moves the generator made', () => {
    configure();
    const report = component.nativeElement.querySelector(
      '[data-testid="settings-brand-contrast-report"]',
    ) as HTMLElement;

    expect(report).not.toBeNull();
    expect(report.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('shows nothing to preview while the primary is not a colour yet', () => {
    configure();
    page.form.controls.primary.setValue('#12');
    component.detectChanges();

    expect(page.palette()).toBeNull();
    expect(page.paletteError()).toBeNull();
  });

  it('refuses to save a colour the generator cannot make readable', () => {
    // A near-white primary cannot carry white text and cannot be moved: it is
    // the operator's own colour, so the screen says so instead of storing a
    // storefront nobody can read.
    configure();
    page.form.controls.primary.setValue('#FFFFF0');
    page.form.controls.primary.markAsDirty();
    page.form.markAsDirty();
    component.detectChanges();
    page.save();

    expect(page.paletteError()).not.toBeNull();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('sends all three colours together, because the API replaces the object', () => {
    configure();
    page.form.controls.secondary.setValue('#3355FF');
    page.form.controls.secondary.markAsDirty();
    page.form.markAsDirty();
    page.save();

    expect(updateSpy).toHaveBeenCalledWith({
      baseColors: { primary: '#1F2937', secondary: '#3355FF', accent: null },
    });
  });

  it('clears an asset with null rather than an empty string', () => {
    configure();
    page.form.controls.logoAssetId.setValue('11111111-1111-4111-8111-111111111111');
    page.form.controls.logoAssetId.markAsDirty();
    page.clearAsset('logoAssetId');
    page.form.markAsDirty();
    page.save();

    expect(updateSpy).toHaveBeenCalledWith({ logoAssetId: null });
  });

  it('refuses a hex the API would reject rather than sending it', () => {
    configure();
    page.form.controls.primary.setValue('teal');
    page.form.controls.primary.markAsDirty();
    page.form.markAsTouched();
    page.form.markAsDirty();
    page.save();

    expect(updateSpy).not.toHaveBeenCalled();
    expect(page.hexError('primary')).toContain('Six digits');
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
