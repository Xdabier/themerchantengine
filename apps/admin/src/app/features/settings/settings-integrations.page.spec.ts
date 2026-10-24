import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { axe, toHaveNoViolations } from 'jest-axe';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { SettingsIntegrationsPage } from './settings-integrations.page';

expect.extend(toHaveNoViolations);

/**
 * Plan I phase I9, finding D5.
 *
 * This page offered six editable credential fields and stored none of them.
 * `updateSettingsRequestSchema` models no `integrations` key, so Zod stripped
 * the whole body, `SettingsService.update` PATCHed `{}`, the API answered 200
 * with nothing changed, and the page rendered "Integrations saved." Three of
 * the six were provider secrets, which constitution §3.7 keeps in environment
 * variables, so "wire it up" was never an available fix for them.
 *
 * The page is now a signpost rather than an editor, and these tests hold it to
 * that: no input, no save button, and a link to the screen that does work.
 */
describe('SettingsIntegrationsPage', () => {
  let component: ComponentFixture<SettingsIntegrationsPage>;

  function configure(perms: string[] = ['settings:view', 'settings:manage']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    component = TestBed.createComponent(SettingsIntegrationsPage);
    component.detectChanges();
  }

  it('offers no editable credential field', () => {
    configure();
    expect(component.nativeElement.querySelectorAll('input')).toHaveLength(0);
  });

  it('offers no save control, so nothing can report a save that never happened', () => {
    configure();
    expect(
      component.nativeElement.querySelector('[data-testid="settings-integrations-save"]'),
    ).toBeNull();
  });

  it('links to the pixel editor, which is where the analytics ids actually live', () => {
    configure();
    const link = component.nativeElement.querySelector(
      '[data-testid="settings-integrations-pixels-link"]',
    ) as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/analytics/pixels');
  });

  it('says where provider secrets belong, rather than implying this screen holds them', () => {
    configure();
    const text = (component.nativeElement.textContent ?? '') as string;
    expect(text).toMatch(/environment variable/i);
  });

  it('names the analytics field that used to live here, so the removal is discoverable', () => {
    // An operator who bookmarked this page to set a GA4 id needs to be told
    // where it went, not shown an empty page.
    configure();
    const text = (component.nativeElement.textContent ?? '') as string;
    expect(text).toMatch(/analytics/i);
  });

  it('has no axe violations', async () => {
    configure();
    expect(await axe(component.nativeElement)).toHaveNoViolations();
  });
});
