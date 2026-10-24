import { TestBed } from '@angular/core/testing';
import { Observable, throwError } from 'rxjs';
import { CurrenciesService, type StoreCurrency } from '@admin-services';
import { AuthStore } from './auth.store';
import { CurrencyStore } from './currency.store';
import { BOOTSTRAP_LOCALE } from '../tokens';

const XTS: StoreCurrency = { code: 'XTS', symbol: 'DT', decimalPlaces: 3, enabled: ['XTS'] };
const AED: StoreCurrency = {
  code: 'AED',
  symbol: 'د.إ',
  decimalPlaces: 2,
  enabled: ['XTS', 'AED'],
};

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

describe('CurrencyStore', () => {
  let getStore: jest.Mock<Observable<StoreCurrency>, []>;
  let auth: AuthStore;

  function setup(): CurrencyStore {
    TestBed.configureTestingModule({
      providers: [
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: CurrenciesService, useValue: { getStore } },
      ],
    });
    auth = TestBed.inject(AuthStore);
    return TestBed.inject(CurrencyStore);
  }

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    getStore = jest.fn(
      () =>
        new Observable<StoreCurrency>((s) => {
          s.next(XTS);
          s.complete();
        }),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('stays empty while unauthenticated', () => {
    const store = setup();
    TestBed.flushEffects();

    expect(getStore).not.toHaveBeenCalled();
    expect(store.config()).toBeNull();
    expect(store.code()).toBeNull();
    expect(store.hydrated()).toBe(false);
    expect(store.enabled()).toEqual([]);
  });

  it('hydrates once when the session becomes authenticated', () => {
    const store = setup();
    TestBed.flushEffects();

    auth.setSession({ user: makeUser() });
    TestBed.flushEffects();

    expect(getStore).toHaveBeenCalledTimes(1);
    expect(store.config()).toEqual(XTS);
    expect(store.code()).toBe('XTS');
    expect(store.enabled()).toEqual(['XTS']);
    // Every money INPUT gate reads this: the scale validator and the native
    // step. A wrong value here means the operator cannot type a millime.
    expect(store.decimalPlaces()).toBe(3);
    expect(store.hydrated()).toBe(true);

    // A later change-detection pass must not refetch.
    TestBed.flushEffects();
    expect(getStore).toHaveBeenCalledTimes(1);
  });

  it('falls back to the store scale while unhydrated, not to two', () => {
    // A too-SMALL scale rejects a legal amount; a too-large one only accepts a
    // value the backend then validates anyway. So the unhydrated fallback errs
    // toward accepting, which is why it is not 2.
    const store = setup();
    TestBed.flushEffects();

    expect(store.hydrated()).toBe(false);
    expect(store.decimalPlaces()).toBe(3);
  });

  it('leaves the config null on a failed fetch and does not throw', () => {
    getStore = jest.fn(() => throwError(() => new Error('boom')));
    const store = setup();

    auth.setSession({ user: makeUser() });
    expect(() => TestBed.flushEffects()).not.toThrow();

    expect(store.config()).toBeNull();
    expect(store.hydrated()).toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });

  // Regression guard: request state must not be a signal the effect reads, or a
  // failed fetch re-triggers the effect and retries forever.
  it('does not retry a failed fetch on later effect passes', () => {
    getStore = jest.fn(() => throwError(() => new Error('boom')));
    setup();

    auth.setSession({ user: makeUser() });
    TestBed.flushEffects();
    TestBed.flushEffects();
    auth.setLocale('ar');
    TestBed.flushEffects();

    expect(getStore).toHaveBeenCalledTimes(1);
  });

  it('re-hydrates for the next session after a sign-out', () => {
    const store = setup();
    auth.setSession({ user: makeUser() });
    TestBed.flushEffects();
    expect(getStore).toHaveBeenCalledTimes(1);

    auth.clear();
    TestBed.flushEffects();

    auth.setSession({ user: makeUser() });
    TestBed.flushEffects();
    expect(getStore).toHaveBeenCalledTimes(2);
    expect(store.code()).toBe('XTS');
  });

  it('refresh() re-reads the store currency', () => {
    const store = setup();
    auth.setSession({ user: makeUser() });
    TestBed.flushEffects();
    expect(store.code()).toBe('XTS');

    getStore.mockReturnValue(
      new Observable<StoreCurrency>((s) => {
        s.next(AED);
        s.complete();
      }),
    );
    store.refresh();

    expect(getStore).toHaveBeenCalledTimes(2);
    expect(store.code()).toBe('AED');
    expect(store.enabled()).toEqual(['XTS', 'AED']);
  });
});
