import { TestBed } from '@angular/core/testing';
import { Observable } from 'rxjs';
import { CurrenciesService, type StoreCurrency } from '@admin-services';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { MoneyPipe } from './money.pipe';
import { CurrencyStore } from '../../core/stores/currency.store';

const EUR: StoreCurrency = { code: 'EUR', symbol: 'ر.ق', decimalPlaces: 2, enabled: ['EUR'] };

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

describe('MoneyPipe', () => {
  let pipe: MoneyPipe;
  let auth: AuthStore;
  let store: CurrencyStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: CurrenciesService,
          useValue: {
            getStore: () =>
              new Observable<StoreCurrency>((s) => {
                s.next(EUR);
                s.complete();
              }),
          },
        },
        MoneyPipe,
      ],
    });
    pipe = TestBed.inject(MoneyPipe);
    auth = TestBed.inject(AuthStore);
    store = TestBed.inject(CurrencyStore);
  });

  function hydrate(): void {
    auth.setSession({ user: makeUser() });
    TestBed.flushEffects();
  }

  it('formats in the store currency with no argument', () => {
    hydrate();
    expect(pipe.transform(100)).toBe('EUR 100.00');
    expect(pipe.transform('6539.2')).toBe('EUR 6,539.20');
  });

  it('formats in the record currency when one is passed', () => {
    hydrate();
    expect(pipe.transform(527, 'USD')).toBe('USD 527.00');
  });

  // D8: before hydration lands, show the amount without inventing a code.
  it('renders a bare amount while the store is unhydrated', () => {
    expect(store.hydrated()).toBe(false);
    expect(pipe.transform(100)).toBe('100.00');
  });

  it('re-emits after a late hydration', () => {
    expect(pipe.transform(100)).toBe('100.00');
    hydrate();
    expect(pipe.transform(100)).toBe('EUR 100.00');
  });

  it('treats an explicit null currency as unknown', () => {
    hydrate();
    expect(pipe.transform(100, null)).toBe('100.00');
  });

  it('returns the fallback for nullish input', () => {
    hydrate();
    expect(pipe.transform(null)).toBe('—');
    expect(pipe.transform(undefined, 'EUR', 'n/a')).toBe('n/a');
  });

  it('memoizes when value, currency and store config are unchanged', () => {
    hydrate();
    const spy = jest.spyOn(Intl, 'NumberFormat');
    expect(pipe.transform(100)).toBe('EUR 100.00');
    const afterFirst = spy.mock.calls.length;
    expect(pipe.transform(100)).toBe('EUR 100.00');
    expect(spy.mock.calls.length).toBe(afterFirst);
    spy.mockRestore();
  });
});
