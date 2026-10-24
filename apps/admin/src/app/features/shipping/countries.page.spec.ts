import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CountriesService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Observable, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { CountriesPage } from './countries.page';

expect.extend(toHaveNoViolations);

/** Two regions on purpose: the page groups by region and toggles a whole one. */
const countries = [
  {
    code: 'FR',
    name: 'France',
    region: 'Western Europe',
    emoji: '🇫🇷',
    enabled: true,
    isDefault: true,
  },
  {
    code: 'ES',
    name: 'Spain',
    region: 'Western Europe',
    emoji: '🇪🇸',
    enabled: false,
    isDefault: false,
  },
  {
    code: 'PT',
    name: 'Portugal',
    region: 'Western Europe',
    emoji: '🇵🇹',
    enabled: false,
    isDefault: false,
  },
  {
    code: 'DE',
    name: 'Germany',
    region: 'Central Europe',
    emoji: '🇩🇪',
    enabled: false,
    isDefault: false,
  },
];

describe('CountriesPage', () => {
  let fixture: ComponentFixture<CountriesPage>;
  let page: CountriesPage;
  let listSpy: jest.Mock;
  let updateSpy: jest.Mock;

  function configure(perms: string[] = ['settings:view', 'settings:manage']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: CountriesService, useValue: { list: listSpy, update: updateSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(CountriesPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listSpy = jest.fn(() => of({ data: countries, defaultCode: 'FR' }));
    updateSpy = jest.fn((body: Record<string, unknown>) =>
      of({
        data: countries.map((c) => ({
          ...c,
          enabled: (body['enabled'] as string[]).includes(c.code),
          isDefault: c.code === body['defaultCode'],
        })),
        defaultCode: body['defaultCode'] ?? 'FR',
      }),
    );
  });

  it('groups rows by region', () => {
    configure();
    const regions = page.grouped().map((g) => g.region);
    expect(regions).toEqual(['Western Europe', 'Central Europe']);
  });

  it('prints the ISO code once per row and no flag emoji', () => {
    // Finding E15: Chromium on Windows has no flag emoji font, so the
    // regional-indicator pair rendered as the raw letters and every row read
    // "FR France … FR".
    configure();
    const root = fixture.nativeElement as HTMLElement;
    const text = root.textContent ?? '';
    expect(text).not.toContain('🇫🇷');
    const row = root.querySelector('[data-testid="country-toggle-FR"]')?.closest('li');
    expect((row?.textContent?.match(/FR/g) ?? []).length).toBe(1);
  });

  it('toggleCountry flips + marks dirty', () => {
    configure();
    expect(page.dirty()).toBe(false);
    page.toggleCountry('ES', { target: { checked: true } } as unknown as Event);
    expect(page.enabled().has('ES')).toBe(true);
    expect(page.dirty()).toBe(true);
  });

  it('setRegion("Western Europe", true) enables every country in the region', () => {
    configure();
    page.setRegion('Western Europe', true);
    expect(page.enabled().has('ES')).toBe(true);
    expect(page.enabled().has('PT')).toBe(true);
  });

  it('setRegion("Western Europe", false) clears the default when it was in that region', () => {
    configure();
    page.setRegion('Western Europe', false);
    expect(page.defaultCode()).toBeNull();
  });

  it('disabling the default code clears defaultCode', () => {
    configure();
    page.toggleCountry('FR', { target: { checked: false } } as unknown as Event);
    expect(page.defaultCode()).toBeNull();
  });

  it('revert rolls back enabled + default + clears dirty', () => {
    configure();
    page.toggleCountry('ES', { target: { checked: true } } as unknown as Event);
    expect(page.dirty()).toBe(true);
    page.revert();
    expect(page.enabled().has('ES')).toBe(false);
    expect(page.defaultCode()).toBe('FR');
    expect(page.dirty()).toBe(false);
  });

  it('save refuses when default is no longer in enabled', () => {
    configure();
    // Unset QA default without clearing enabled for AE (but QA is still enabled).
    page.onDefaultChange({ target: { value: 'AE' } } as unknown as Event);
    page.save();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(page.error()).toContain('Default country must');
  });

  it('save PATCHes the diff', () => {
    configure();
    page.toggleCountry('ES', { target: { checked: true } } as unknown as Event);
    page.save();
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: expect.arrayContaining(['FR', 'ES']) }),
    );
  });

  it('ApiForbiddenError surfaces a permission-safe error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('ApiNotFoundError surfaces the countries-not-found error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Countries not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations on the loading skeleton', async () => {
    listSpy = jest.fn(() => new Observable(() => undefined));
    configure();
    expect(page.loading()).toBe(true);
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations when the error banner is rendered', async () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).not.toBeNull();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('settings:view-only session disables management actions', () => {
    configure(['settings:view']);
    expect(page.canManage()).toBe(false);
    const saveBtn = fixture.nativeElement.querySelector(
      'app-button[data-testid="country-save"] button',
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    const firstToggle = fixture.nativeElement.querySelector(
      '[data-testid="country-toggle-FR"]',
    ) as HTMLInputElement;
    expect(firstToggle.disabled).toBe(true);
  });

  it('has no axe violations in read-only mode', async () => {
    configure(['settings:view']);
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('saved banner auto-clears after the 3s timeout', () => {
    jest.useFakeTimers();
    try {
      configure();
      page.toggleCountry('ES', { target: { checked: true } } as unknown as Event);
      page.save();
      expect(page.saved()).toBe(true);
      jest.advanceTimersByTime(3000);
      expect(page.saved()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('save refuses an empty enabled list with branded copy', () => {
    configure();
    page.setRegion('Western Europe', false);
    page.setRegion('Central Europe', false);
    expect(page.enabled().size).toBe(0);
    page.save();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(page.error()).toBe('Enable at least one country before saving.');
  });

  it('update failure surfaces the save-path fallback copy', () => {
    updateSpy = jest.fn(() => throwError(() => new ApiError({ code: 'ERR', message: '' })));
    configure();
    page.toggleCountry('ES', { target: { checked: true } } as unknown as Event);
    page.save();
    expect(page.error()).toBe('Could not save countries.');
  });

  it('successful save reseats initial checkpoints so dirty() clears', () => {
    configure();
    page.toggleCountry('ES', { target: { checked: true } } as unknown as Event);
    expect(page.dirty()).toBe(true);
    page.save();
    expect(page.dirty()).toBe(false);
  });
});
