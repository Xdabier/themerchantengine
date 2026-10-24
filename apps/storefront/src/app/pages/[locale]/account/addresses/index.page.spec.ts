import { ChangeDetectionStrategy, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UsersService } from '@storefront-services';
import type { Address, CustomerUser } from '@storefront-types';

import { LocaleService } from '../../../../locale.service';
import { AuthStateService } from '../../../../services/auth-state.service';
import { getChromeStrings } from '../../../../../i18n';
import { type Locale } from '../../../../../i18n/types';
import AddressesPage from './index.page';
import { fixtureChromeIdentity } from '../../../../../test-support/store-config-fixtures';

class StubLocaleService {
  private readonly _locale: WritableSignal<Locale>;
  constructor(initial: Locale) {
    this._locale = signal<Locale>(initial);
  }
  readonly locale = () => this._locale();
  readonly chromeIdentity = () => fixtureChromeIdentity('demo', this._locale());
  readonly strings = () => getChromeStrings(this._locale(), this.chromeIdentity());
  // The shared account nav derives `aria-current` from the live URL.
  readonly currentUrl = () => `/${this._locale()}/account`;
}

function makeAuth(authed: boolean) {
  return {
    isAuthed: () => authed,
    // The page awaits the boot outcome before deciding (finding N4); these
    // stubs model a boot that has already settled.
    whenBooted: async () => undefined,
    bootState: () => 'booted',
    currentUser: () => null,
    clearSession: vi.fn(),
  } as unknown as AuthStateService;
}

const baseAddress: Address = {
  id: 'addr-1',
  fullName: 'Jane Lyon',
  phone: '+97412345678',
  addressLine1: '1 Pearl',
  city: 'Lyon',
  country: 'QA',
  isDefaultShipping: true,
} as Address;

interface RenderOpts {
  locale: Locale;
  authed: boolean;
  initialAddresses?: Address[];
  getMeThrows?: unknown;
  deleteThrows?: unknown;
}

interface RenderResult {
  fixture: ComponentFixture<AddressesPage>;
  navigateSpy: ReturnType<typeof vi.fn>;
  users: {
    getMe: ReturnType<typeof vi.fn>;
    createAddress: ReturnType<typeof vi.fn>;
    updateAddress: ReturnType<typeof vi.fn>;
    deleteAddress: ReturnType<typeof vi.fn>;
    setDefaultAddress: ReturnType<typeof vi.fn>;
  };
}

async function renderAddresses(opts: RenderOpts): Promise<RenderResult> {
  const stub = new StubLocaleService(opts.locale);
  const auth = makeAuth(opts.authed);
  let storedAddresses: Address[] = opts.initialAddresses ?? [baseAddress];
  const users = {
    getMe: vi.fn(async () => {
      if (opts.getMeThrows) throw opts.getMeThrows;
      return {
        id: 'u1',
        email: 'jane@example.com',
        addresses: storedAddresses,
      } as unknown as CustomerUser;
    }),
    createAddress: vi.fn(async (input: Partial<Address>) => {
      const a = { id: 'addr-new', ...input } as Address;
      storedAddresses = [...storedAddresses, a];
      return a;
    }),
    updateAddress: vi.fn(async (id: string, input: Partial<Address>) => {
      storedAddresses = storedAddresses.map((a) =>
        a.id === id ? ({ ...a, ...input } as Address) : a,
      );
      return storedAddresses.find((a) => a.id === id) as Address;
    }),
    deleteAddress: vi.fn(async (id: string) => {
      if (opts.deleteThrows) throw opts.deleteThrows;
      storedAddresses = storedAddresses.filter((a) => a.id !== id);
    }),
    setDefaultAddress: vi.fn(async (id: string) => {
      storedAddresses = storedAddresses.map((a) => ({
        ...a,
        isDefaultShipping: a.id === id,
      }));
      return storedAddresses.find((a) => a.id === id) as Address;
    }),
  };

  TestBed.overrideComponent(AddressesPage, {
    set: { changeDetection: ChangeDetectionStrategy.Default },
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: LocaleService, useValue: stub },
      { provide: AuthStateService, useValue: auth },
      { provide: UsersService, useValue: users },
    ],
  });
  const router = TestBed.inject(Router);
  const navigateSpy = vi.fn(async () => true);
  router.navigateByUrl = navigateSpy as never;

  const fixture = TestBed.createComponent(AddressesPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  // Second flush: the page now awaits the session boot outcome before it even
  // reaches its data load (finding N4), so the load settles one turn later.
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, navigateSpy, users };
}

describe('AccountAddressesPage', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  it('renders the SSR shell + address card list', async () => {
    const { fixture } = await renderAddresses({ locale: 'fr', authed: true });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="account-addresses-page"]')).not.toBeNull();
    expect(root.querySelectorAll('[data-testid="account-addresses-list"] li').length).toBe(1);
  });

  it('redirects an anonymous visitor to /auth/login', async () => {
    const { navigateSpy } = await renderAddresses({ locale: 'en', authed: false });
    expect(navigateSpy).toHaveBeenCalled();
    expect(navigateSpy.mock.calls[0][0]).toContain('/en/auth/login');
  });

  it('renders the empty state when getMe returns no addresses', async () => {
    const { fixture } = await renderAddresses({
      locale: 'en',
      authed: true,
      initialAddresses: [],
    });
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="account-addresses-empty"]',
      ),
    ).not.toBeNull();
  });

  it('opens the form on Add and shows it for create mode', async () => {
    const { fixture } = await renderAddresses({ locale: 'en', authed: true });
    const root = fixture.nativeElement as HTMLElement;
    const addBtn = Array.from(root.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').toLowerCase().includes('add new address'),
    ) as HTMLButtonElement;
    addBtn.click();
    fixture.detectChanges();
    expect(root.querySelector('app-address-form')).not.toBeNull();
  });

  it('asks for delete confirmation before calling deleteAddress', async () => {
    const { fixture, users } = await renderAddresses({ locale: 'en', authed: true });
    const root = fixture.nativeElement as HTMLElement;
    const deleteBtn = root.querySelector(
      `[data-testid="address-card-delete-${baseAddress.id}"]`,
    ) as HTMLButtonElement;
    deleteBtn.click();
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="account-addresses-delete-confirm"]')).not.toBeNull();
    expect(users.deleteAddress).not.toHaveBeenCalled();

    const confirmBtn = Array.from(root.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').toLowerCase().includes('yes, delete'),
    ) as HTMLButtonElement;
    confirmBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(users.deleteAddress).toHaveBeenCalledWith(baseAddress.id);
  });

  it('calls setDefaultAddress when a non-default address is set as default', async () => {
    const second: Address = { ...baseAddress, id: 'addr-2', isDefaultShipping: false } as Address;
    const { fixture, users } = await renderAddresses({
      locale: 'en',
      authed: true,
      initialAddresses: [baseAddress, second],
    });
    const root = fixture.nativeElement as HTMLElement;
    const btn = root.querySelector(
      `[data-testid="address-card-set-default-${second.id}"]`,
    ) as HTMLButtonElement;
    btn.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(users.setDefaultAddress).toHaveBeenCalledWith(second.id, { isDefaultShipping: true });
  });

  it('renders the error branch when getMe throws', async () => {
    const { StorefrontServerError } = await import('@storefront-types');
    const { fixture } = await renderAddresses({
      locale: 'en',
      authed: true,
      getMeThrows: new StorefrontServerError({ code: 'SERVER', message: 'boom' }),
    });
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="account-addresses-error"]',
      ),
    ).not.toBeNull();
  });
});
