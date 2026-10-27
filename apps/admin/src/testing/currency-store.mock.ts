import { computed, signal, type Provider } from '@angular/core';
import type { StoreCurrency } from '@admin-services';
import { MONEY_DECIMAL_PLACES } from '@admin-types';
import { CurrencyStore } from '../app/core/stores/currency.store';

/**
 * A three-decimal store, which is the shape a millime-style currency needs.
 *
 * Three decimal places is not a style choice: a currency whose minor unit is a
 * thousandth cannot represent a real price in two.
 */
export const XTS_STORE: StoreCurrency = {
  code: 'XTS',
  symbol: 'DT',
  decimalPlaces: 3,
  enabled: ['XTS'],
};

/**
 * A hydrated `CurrencyStore` for component specs.
 *
 * Any spec whose component renders money reaches `CurrencyStore` through the
 * `money` pipe, and the real store injects `AuthStore` and `CurrenciesService`.
 * Rather than teach every spec to stub both, provide this: the component sees a
 * store that is already hydrated, so assertions read the real formatted output
 * (`XTS 100.000`) instead of the unhydrated bare-amount fallback.
 *
 * Pass `null` to exercise the unhydrated path.
 */
export function provideCurrencyStoreStub(config: StoreCurrency | null = XTS_STORE): Provider {
  const value = signal<StoreCurrency | null>(config);
  return {
    provide: CurrencyStore,
    useValue: {
      config: value.asReadonly(),
      code: computed(() => value()?.code ?? null),
      enabled: computed<readonly string[]>(() => value()?.enabled ?? []),
      // Mirrors the real store's fallback: the store scale rather than 2, so
      // an unhydrated form still accepts a legal millime. Every money INPUT
      // gate reads this — the scale validator and the native `step`.
      decimalPlaces: computed(() => value()?.decimalPlaces ?? MONEY_DECIMAL_PLACES),
      hydrated: computed(() => value() !== null),
      refresh: (): void => undefined,
      /** Test-only lever: move the store from unhydrated to hydrated mid-spec. */
      set: (next: StoreCurrency | null): void => value.set(next),
    },
  };
}
