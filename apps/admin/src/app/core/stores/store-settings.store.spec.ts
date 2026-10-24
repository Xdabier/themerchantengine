import { TestBed } from '@angular/core/testing';
import { Observable, throwError } from 'rxjs';
import { NEUTRAL_LOCALE_SET } from '@merchants/shared-common';
import { SettingsService, type SettingsResponse } from '@admin-services';
import { FALLBACK_TRANSLATABLE_LOCALE_TABS } from '@admin-ui/atoms/translatable-locales.token';
import { AuthStore } from './auth.store';
import { StoreSettingsStore } from './store-settings.store';
import { BOOTSTRAP_LOCALE } from '../tokens';

function settings(
  timezone: unknown,
  localization: Record<string, unknown> = {},
  identity: Record<string, Record<string, unknown>> = {},
): SettingsResponse {
  return {
    general: { storeName: { default: 'Demo Store', fr: 'Boutique Démo' } },
    localization: {
      timezone,
      defaultLocale: 'fr',
      supportedLocales: ['fr', 'en'],
      ...localization,
    },
    ...identity,
  } as SettingsResponse;
}

function makeUser() {
  return {
    id: 'u1',
    email: 'admin@merchants.test',
    firstName: 'A',
    lastName: 'B',
    role: 'SUPER_ADMIN',
    permissions: [],
    isActive: true,
  } as never;
}

/** Tabs for a store that writes every one of its locales left to right. */
function LTR(codes: readonly string[]) {
  return codes.map((code) => ({ code, dir: 'ltr' }));
}

describe('StoreSettingsStore', () => {
  let getAll: jest.Mock<Observable<SettingsResponse>, []>;
  let auth: AuthStore;

  function setup(): StoreSettingsStore {
    TestBed.configureTestingModule({
      providers: [
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: SettingsService, useValue: { getAll } },
      ],
    });
    auth = TestBed.inject(AuthStore);
    return TestBed.inject(StoreSettingsStore);
  }

  function respond(
    timezone: unknown,
    localization: Record<string, unknown> = {},
    identity: Record<string, Record<string, unknown>> = {},
  ): void {
    getAll.mockReturnValue(
      new Observable<SettingsResponse>((s) => {
        s.next(settings(timezone, localization, identity));
        s.complete();
      }),
    );
  }

  /** Hydrate the store and hand it back, which every identity case needs. */
  function hydrated(): StoreSettingsStore {
    const store = setup();
    TestBed.flushEffects();
    auth.setSession({ user: makeUser() });
    TestBed.flushEffects();
    return store;
  }

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    getAll = jest.fn();
    respond('Europe/Paris');
  });

  afterEach(() => jest.restoreAllMocks());

  it('reports UTC and fetches nothing while unauthenticated', () => {
    const store = setup();
    TestBed.flushEffects();

    expect(getAll).not.toHaveBeenCalled();
    expect(store.timezone()).toBe('UTC');
    expect(store.hydrated()).toBe(false);
  });

  it('hydrates the store timezone once the session is authenticated', () => {
    const store = setup();
    TestBed.flushEffects();

    auth.setSession({ user: makeUser() });
    TestBed.flushEffects();

    expect(getAll).toHaveBeenCalledTimes(1);
    expect(store.timezone()).toBe('Europe/Paris');
    expect(store.hydrated()).toBe(true);

    TestBed.flushEffects();
    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it('keeps UTC when the setting is missing or malformed', () => {
    respond('Not/AZone');
    const store = setup();
    auth.setSession({ user: makeUser() });
    TestBed.flushEffects();
    expect(store.timezone()).toBe('UTC');
    expect(store.hydrated()).toBe(false);

    respond(undefined);
    store.refresh();
    expect(store.timezone()).toBe('UTC');
  });

  it('keeps UTC on a failed fetch and does not throw', () => {
    getAll.mockReturnValue(throwError(() => new Error('boom')));
    const store = setup();

    auth.setSession({ user: makeUser() });
    expect(() => TestBed.flushEffects()).not.toThrow();

    expect(store.timezone()).toBe('UTC');
    expect(console.warn).toHaveBeenCalled();
  });

  it('does not retry a failed fetch on later effect passes', () => {
    getAll.mockReturnValue(throwError(() => new Error('boom')));
    setup();

    auth.setSession({ user: makeUser() });
    TestBed.flushEffects();
    TestBed.flushEffects();
    auth.setLocale('ar');
    TestBed.flushEffects();

    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it('refresh() re-reads the timezone after the settings screen saves', () => {
    const store = setup();
    auth.setSession({ user: makeUser() });
    TestBed.flushEffects();
    expect(store.timezone()).toBe('Europe/Paris');

    respond('Europe/Paris');
    store.refresh();

    expect(getAll).toHaveBeenCalledTimes(2);
    expect(store.timezone()).toBe('Europe/Paris');
  });

  describe('store identity', () => {
    it('resolves the store name against the store default locale', () => {
      // Not the operator's locale. An operator reading the admin in English
      // is still working on a store whose name is what the store calls
      // itself, and `TranslatablePipe` cannot express that: it is bound to
      // `AuthStore.locale()` and takes no locale argument.
      auth.setLocale('en');
      const store = hydrated();
      expect(store.storeName()).toBe('Boutique Démo');
    });

    it('falls back through the Translatable chain when the default locale is absent', () => {
      respond('Europe/Paris', {}, {});
      const store = hydrated();
      expect(store.storeName()).toBe('Boutique Démo');

      respond('Europe/Paris', { defaultLocale: 'de' });
      store.refresh();
      // No `de` key, so the chain reaches `en` and then `default`.
      expect(store.storeName()).toBe('Demo Store');
    });

    it('reports an empty name rather than a placeholder when the store has none', () => {
      getAll.mockReturnValue(
        new Observable<SettingsResponse>((s) => {
          s.next({
            localization: { defaultLocale: 'fr', supportedLocales: ['fr'] },
          } as SettingsResponse);
          s.complete();
        }),
      );
      const store = hydrated();
      expect(store.storeName()).toBe('');
    });

    it('renders the appearance URL and surfaces the brand asset separately', () => {
      // Not a preference order. An asset id has no public serving route, so
      // the shell can only put the URL in an `img`; the asset is exposed for
      // the brand screen that will give it one.
      respond(
        'Europe/Paris',
        {},
        {
          brand: { logoAssetId: 'asset-1' },
          appearance: { logoUrl: '/uploads/mark.png' },
        },
      );
      const store = hydrated();
      expect(store.logoUrl()).toBe('/uploads/mark.png');
      expect(store.logoAssetId()).toBe('asset-1');
    });

    it('reports no URL when only the brand asset is set', () => {
      respond('Europe/Paris', {}, { brand: { logoAssetId: 'asset-1' } });
      const store = hydrated();
      expect(store.logoUrl()).toBeNull();
      expect(store.logoAssetId()).toBe('asset-1');
    });

    it('treats a blank URL as no logo rather than as an empty image', () => {
      respond('Europe/Paris', {}, { appearance: { logoUrl: '   ' } });
      expect(hydrated().logoUrl()).toBeNull();
    });

    it('reports no logo when neither is set, which is every seeded install', () => {
      // `brand.logoAssetId` is null in all three scenario fixtures and no seed
      // path writes `appearance.logoUrl`, so this is the branch production
      // actually takes until an operator uploads one.
      const store = hydrated();
      expect(store.logoUrl()).toBeNull();
      expect(store.logoAssetId()).toBeNull();
    });
  });
});

describe('StoreSettingsStore locale set', () => {
  let getAll: jest.Mock<Observable<SettingsResponse>, []>;
  let auth: AuthStore;

  function setup(): StoreSettingsStore {
    TestBed.configureTestingModule({
      providers: [
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: SettingsService, useValue: { getAll } },
      ],
    });
    auth = TestBed.inject(AuthStore);
    return TestBed.inject(StoreSettingsStore);
  }

  function respondWith(localization: Record<string, unknown>): void {
    getAll.mockReturnValue(
      new Observable<SettingsResponse>((s) => {
        s.next({
          general: {},
          localization: { timezone: 'Europe/Paris', ...localization },
        } as SettingsResponse);
        s.complete();
      }),
    );
  }

  function hydrate(): StoreSettingsStore {
    const store = setup();
    TestBed.flushEffects();
    auth.setSession({ user: makeUser() });
    TestBed.flushEffects();
    return store;
  }

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    getAll = jest.fn();
  });

  afterEach(() => jest.restoreAllMocks());

  it('falls back to the neutral locale set while settings have not answered', () => {
    respondWith({ defaultLocale: 'fr', supportedLocales: ['fr', 'en'] });
    const store = setup();
    TestBed.flushEffects();

    expect(getAll).not.toHaveBeenCalled();
    expect(store.supportedLocales()).toEqual(NEUTRAL_LOCALE_SET.supportedLocales);
    expect(store.defaultLocale()).toBe(NEUTRAL_LOCALE_SET.defaultLocale);
    expect(store.localeTabs()).toEqual(FALLBACK_TRANSLATABLE_LOCALE_TABS);
  });

  it('falls back to the neutral locale set when the settings fetch fails outright', () => {
    getAll.mockReturnValue(throwError(() => new Error('boom')));
    const store = hydrate();

    expect(getAll).toHaveBeenCalledTimes(1);
    expect(store.supportedLocales()).toEqual(NEUTRAL_LOCALE_SET.supportedLocales);
    expect(store.localeTabs()).toEqual(FALLBACK_TRANSLATABLE_LOCALE_TABS);
  });

  it('adopts the locale set the settings answer carries', () => {
    respondWith({ defaultLocale: 'en', supportedLocales: ['en', 'fr', 'de'] });
    const store = hydrate();

    expect(store.supportedLocales()).toEqual(['en', 'fr', 'de']);
    expect(store.defaultLocale()).toBe('en');
  });

  it('puts the default locale first, wherever settings listed it', () => {
    // Load-bearing: the Translatable atoms mirror the FIRST tab's value into the
    // `default` key, so a list that does not lead with the store default writes
    // the wrong language into the rung the storefront falls back to.
    respondWith({ defaultLocale: 'de', supportedLocales: ['en', 'fr', 'de'] });
    const store = hydrate();

    expect(store.localeTabs()).toEqual(LTR(['de', 'en', 'fr']));
    expect(store.localeTabs().filter((t) => t.code === 'de')).toHaveLength(1);
  });

  it('still leads with the default when settings omit it from the supported list', () => {
    respondWith({ defaultLocale: 'it', supportedLocales: ['en', 'fr'] });
    const store = hydrate();

    expect(store.localeTabs()).toEqual(LTR(['it', 'en', 'fr']));
  });

  it('ignores a malformed locale payload rather than emptying the tab strip', () => {
    respondWith({ defaultLocale: 42, supportedLocales: 'fr,en' });
    const store = hydrate();

    expect(store.supportedLocales()).toEqual(NEUTRAL_LOCALE_SET.supportedLocales);
    expect(store.defaultLocale()).toBe(NEUTRAL_LOCALE_SET.defaultLocale);
  });

  it('drops non-string entries from a partly malformed supported list', () => {
    respondWith({ defaultLocale: 'fr', supportedLocales: ['fr', 7, '', 'en'] });
    const store = hydrate();

    expect(store.supportedLocales()).toEqual(['fr', 'en']);
    expect(store.localeTabs()).toEqual(LTR(['fr', 'en']));
  });
});

/**
 * Plan E3.4.2 and E3.4.3. Two settings keys the admin stored and never read:
 * `localization.rtlLocales`, which decides which way a Translatable tab types,
 * and `money.symbolPosition`, which decides which side of a money input the
 * currency symbol sits on.
 */
describe('StoreSettingsStore direction and money format', () => {
  let getAll: jest.Mock<Observable<SettingsResponse>, []>;
  let auth: AuthStore;

  function setup(): StoreSettingsStore {
    TestBed.configureTestingModule({
      providers: [
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: SettingsService, useValue: { getAll } },
      ],
    });
    auth = TestBed.inject(AuthStore);
    return TestBed.inject(StoreSettingsStore);
  }

  function respondWith(groups: Record<string, Record<string, unknown>>): void {
    getAll.mockReturnValue(
      new Observable<SettingsResponse>((s) => {
        s.next({
          general: {},
          localization: { timezone: 'UTC', ...(groups['localization'] ?? {}) },
          ...groups,
        } as SettingsResponse);
        s.complete();
      }),
    );
  }

  function hydrate(): StoreSettingsStore {
    const store = setup();
    TestBed.flushEffects();
    auth.setSession({ user: makeUser() });
    TestBed.flushEffects();
    return store;
  }

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    getAll = jest.fn();
    respondWith({});
  });

  afterEach(() => jest.restoreAllMocks());

  it('marks the configured locales right-to-left on their tabs', () => {
    respondWith({
      localization: { supportedLocales: ['en', 'ar'], defaultLocale: 'en', rtlLocales: ['ar'] },
    });
    const store = hydrate();

    expect(store.rtlLocales()).toEqual(['ar']);
    expect(store.localeTabs()).toEqual([
      { code: 'en', dir: 'ltr' },
      { code: 'ar', dir: 'rtl' },
    ]);
  });

  it('writes every locale left to right until the store says otherwise', () => {
    respondWith({ localization: { supportedLocales: ['en', 'ar'], defaultLocale: 'en' } });
    const store = hydrate();

    expect(store.rtlLocales()).toEqual([]);
    expect(store.localeTabs().every((tab) => tab.dir === 'ltr')).toBe(true);
  });

  it('drops non-string entries from a partly malformed rtl list', () => {
    respondWith({
      localization: { supportedLocales: ['en', 'ar'], defaultLocale: 'en', rtlLocales: ['ar', 7] },
    });

    expect(hydrate().rtlLocales()).toEqual(['ar']);
  });

  it('ignores an rtl payload that is not a list at all', () => {
    respondWith({
      localization: { supportedLocales: ['en', 'ar'], defaultLocale: 'en', rtlLocales: 'ar' },
    });

    expect(hydrate().rtlLocales()).toEqual([]);
  });

  it('adopts the configured symbol position', () => {
    respondWith({ money: { symbolPosition: 'after' } });

    expect(hydrate().symbolPosition()).toBe('after');
  });

  it('falls back to the engine default before settings answer', () => {
    const store = setup();
    TestBed.flushEffects();

    expect(store.symbolPosition()).toBe('before');
  });

  it('ignores a symbol position that is neither side', () => {
    respondWith({ money: { symbolPosition: 'above' } });

    expect(hydrate().symbolPosition()).toBe('before');
  });
});
