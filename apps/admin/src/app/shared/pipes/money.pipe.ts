import { Pipe, PipeTransform, inject } from '@angular/core';
import { formatMoney, type MoneyCurrency } from '../format/money';
import { CurrencyStore } from '../../core/stores/currency.store';

/**
 * Render an amount as money in the canonical admin format — `XTS 1,240.000`.
 *
 * Deliberately different from the storefront format (`1 240,000 DT`). See the
 * doc block on `formatMoney` for why the two surfaces diverge on purpose.
 *
 * Two usages:
 *  - `{{ v.price | money }}` — the store currency, from `CurrencyStore`. Use this
 *    for anything priced in the store's own currency (products, analytics, cart
 *    inputs). It is the reason the admin no longer hardcodes a currency.
 *  - `{{ order.total | money: order.currency }}` — the currency recorded on the
 *    row. Use this wherever the entity carries its own currency (orders, returns,
 *    gift cards), so a historical record keeps rendering in what it was written in.
 *
 * Impure so a late `CurrencyStore` hydration re-renders every visible amount;
 * memoized on `(value, currencyArg, storeConfig)` so steady-state cost is one
 * reference comparison per cell.
 *
 * Pure utils (promotions, shipping) keep taking the currency as an explicit
 * required parameter instead of using this pipe, so they stay injectable-free.
 */
@Pipe({ name: 'money', standalone: true, pure: false })
export class MoneyPipe implements PipeTransform {
  private readonly store = inject(CurrencyStore);

  private lastValue: number | string | null | undefined;
  private lastCurrencyArg: MoneyCurrency;
  private lastStoreConfig: MoneyCurrency;
  private lastFallback = '';
  private lastResult = '';
  private primed = false;

  transform(
    value: number | string | null | undefined,
    currency?: MoneyCurrency,
    fallback = '—',
  ): string {
    const storeConfig = this.store.config();
    if (
      this.primed &&
      value === this.lastValue &&
      currency === this.lastCurrencyArg &&
      storeConfig === this.lastStoreConfig &&
      fallback === this.lastFallback
    ) {
      return this.lastResult;
    }

    this.lastValue = value;
    this.lastCurrencyArg = currency;
    this.lastStoreConfig = storeConfig;
    this.lastFallback = fallback;
    // An explicit argument wins; `undefined` (no argument) means the store
    // currency. An explicit `null` means "unknown", and renders bare.
    this.lastResult = formatMoney(value, currency === undefined ? storeConfig : currency, fallback);
    this.primed = true;
    return this.lastResult;
  }
}
