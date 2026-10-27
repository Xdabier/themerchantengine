import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CurrenciesService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Observable, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { CurrenciesPage } from './currencies.page';
import { CurrencyStore } from '../../core/stores/currency.store';

expect.extend(toHaveNoViolations);

const currencies = [
  {
    code: 'EUR',
    name: 'Euro',
    symbol: 'ر.ق',
    region: 'GCC',
    decimalPlaces: 2,
    enabled: true,
    isDefault: true,
  },
  {
    code: 'AED',
    name: 'UAE Dirham',
    symbol: 'د.إ',
    region: 'GCC',
    decimalPlaces: 2,
    enabled: false,
    isDefault: false,
  },
  {
    code: 'USD',
    name: 'US Dollar',
    symbol: '$',
    region: 'Americas',
    decimalPlaces: 2,
    enabled: false,
    isDefault: false,
  },
];

describe('CurrenciesPage', () => {
  let currencyStoreStub: { refresh: jest.Mock };
  let fixture: ComponentFixture<CurrenciesPage>;
  let page: CurrenciesPage;
  let listSpy: jest.Mock;
  let updateSpy: jest.Mock;

  function makeCurrencyStoreStub() {
    return { refresh: jest.fn() };
  }

  function configure(perms: string[] = ['settings:view', 'settings:manage']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: CurrenciesService, useValue: { list: listSpy, update: updateSpy } },
        { provide: CurrencyStore, useValue: currencyStoreStub },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(CurrenciesPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    currencyStoreStub = makeCurrencyStoreStub();
    listSpy = jest.fn(() => of({ data: currencies, defaultCode: 'EUR' }));
    updateSpy = jest.fn((body: Record<string, unknown>) =>
      of({
        data: currencies.map((c) => ({
          ...c,
          enabled: (body['enabled'] as string[]).includes(c.code),
          isDefault: c.code === body['defaultCode'],
        })),
        defaultCode: body['defaultCode'] ?? 'EUR',
      }),
    );
  });

  it('groups rows by region', () => {
    configure();
    const regions = page.grouped().map((g) => g.region);
    expect(regions).toEqual(['GCC', 'Americas']);
  });

  it('toggleCurrency flips + marks dirty', () => {
    configure();
    expect(page.dirty()).toBe(false);
    page.toggleCurrency('USD', { target: { checked: true } } as unknown as Event);
    expect(page.enabled().has('USD')).toBe(true);
    expect(page.dirty()).toBe(true);
  });

  it('setRegion enables every code in the region', () => {
    configure();
    page.setRegion('GCC', true);
    expect(page.enabled().has('AED')).toBe(true);
  });

  it('disabling the default clears defaultCode', () => {
    configure();
    page.toggleCurrency('EUR', { target: { checked: false } } as unknown as Event);
    expect(page.defaultCode()).toBeNull();
  });

  it('save refuses when default is not in enabled', () => {
    configure();
    page.onDefaultChange({ target: { value: 'USD' } } as unknown as Event);
    page.save();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(page.error()).toContain('Default currency must');
  });

  it('save PATCHes the diff', () => {
    configure();
    page.toggleCurrency('USD', { target: { checked: true } } as unknown as Event);
    page.save();
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: expect.arrayContaining(['EUR', 'USD']) }),
    );
  });

  it('ApiForbiddenError surfaces a permission-safe error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('ApiNotFoundError surfaces the currencies-not-found error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Currencies not found.');
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

  it('setRegion disable-all clears defaultCode when default lives in that region', () => {
    configure();
    expect(page.defaultCode()).toBe('EUR');
    page.setRegion('GCC', false);
    expect(page.defaultCode()).toBeNull();
    expect(page.enabled().has('EUR')).toBe(false);
  });

  it('revert restores initialEnabled + initialDefault and clears dirty', () => {
    configure();
    page.toggleCurrency('USD', { target: { checked: true } } as unknown as Event);
    page.onDefaultChange({ target: { value: '' } } as unknown as Event);
    expect(page.dirty()).toBe(true);
    page.revert();
    expect(page.enabled().has('USD')).toBe(false);
    expect(page.defaultCode()).toBe('EUR');
    expect(page.dirty()).toBe(false);
  });

  it('settings:view-only session disables management actions', () => {
    configure(['settings:view']);
    expect(page.canManage()).toBe(false);
    const saveBtn = fixture.nativeElement.querySelector(
      'app-button[data-testid="currency-save"] button',
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    const firstToggle = fixture.nativeElement.querySelector(
      '[data-testid="currency-toggle-EUR"]',
    ) as HTMLInputElement;
    expect(firstToggle.disabled).toBe(true);
  });

  it('saved banner auto-clears after the 3s timeout', () => {
    jest.useFakeTimers();
    try {
      configure();
      page.toggleCurrency('USD', { target: { checked: true } } as unknown as Event);
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
    page.setRegion('GCC', false);
    page.setRegion('MENA', false);
    page.setRegion('Europe', false);
    page.setRegion('Americas', false);
    page.setRegion('Asia-Pacific', false);
    expect(page.enabled().size).toBe(0);
    page.save();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(page.error()).toBe('Enable at least one currency before saving.');
  });

  it('update failure surfaces the save-path fallback copy', () => {
    updateSpy = jest.fn(() => throwError(() => new ApiError({ code: 'ERR', message: '' })));
    configure();
    page.toggleCurrency('USD', { target: { checked: true } } as unknown as Event);
    page.save();
    expect(page.error()).toBe('Could not save currencies.');
  });

  it('successful save reseats initial checkpoints so dirty() clears', () => {
    configure();
    page.toggleCurrency('USD', { target: { checked: true } } as unknown as Event);
    expect(page.dirty()).toBe(true);
    page.save();
    expect(page.dirty()).toBe(false);
  });
  // The store currency drives money formatting on every other screen, so this
  // editor has to tell the store to re-read after it writes.
  it('refreshes the currency store after a successful save', () => {
    configure();
    page.toggleCurrency('USD', { target: { checked: true } } as unknown as Event);
    page.save();

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(currencyStoreStub.refresh).toHaveBeenCalledTimes(1);
  });
});
