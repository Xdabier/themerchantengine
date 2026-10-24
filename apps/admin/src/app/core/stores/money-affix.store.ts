import { Injectable, computed, inject } from '@angular/core';
import { CurrencyStore } from './currency.store';
import { StoreSettingsStore } from './store-settings.store';

/**
 * The adornment every money INPUT in the admin renders beside the number.
 *
 * Two settings decide it and they live in different places: the symbol comes
 * from the store currency (`GET /v1/admin/currencies/store`) and its side comes
 * from the `money` settings group (`symbolPosition`). Before this store every
 * money input hardcoded the ISO code as a suffix, so a store that writes
 * `€ 12,00` was shown `12.00 EUR` on every form in the dashboard and the
 * `symbolPosition` setting had no reader anywhere in the admin.
 *
 * Read-only display amounts are deliberately NOT routed through here:
 * `shared/format/money.ts` documents the admin convention that a rendered
 * amount always carries the unambiguous ISO code, and an operator reading a
 * report is a different audience from an operator typing into a field.
 *
 * Both sources can be unhydrated, and then both affixes are null and the field
 * renders bare. That is the same rule `CurrencyStore` already follows: never
 * invent a currency.
 */
@Injectable({ providedIn: 'root' })
export class MoneyAffixStore {
  private readonly currency = inject(CurrencyStore);
  private readonly settings = inject(StoreSettingsStore);

  /**
   * The symbol to render, falling back to the ISO code.
   *
   * A currency with no configured symbol is shown by its code rather than by
   * nothing: the code is correct, just longer.
   */
  readonly symbol = computed<string | null>(() => {
    const configured = this.currency.config()?.symbol?.trim();
    return configured && configured.length > 0 ? configured : this.currency.code();
  });

  /** The ISO code, for the accessible name a visual adornment cannot carry. */
  readonly code = computed<string | null>(() => this.currency.code());

  /** Inline-start adornment, or null when the store writes the symbol after. */
  readonly prefix = computed<string | null>(() =>
    this.settings.symbolPosition() === 'before' ? this.symbol() : null,
  );

  /** Inline-end adornment, or null when the store writes the symbol before. */
  readonly suffix = computed<string | null>(() =>
    this.settings.symbolPosition() === 'after' ? this.symbol() : null,
  );

  /**
   * Affixes for an amount held in a currency that is not the store's own.
   *
   * A gift card is written in the currency it was issued in and stays in it, so
   * a balance adjustment names that currency rather than today's store default.
   * Only the code is available for a foreign currency, since the symbol comes
   * from the store currency config, but the side the store writes its money on
   * is still the operator's own convention and is honoured here.
   */
  affixesFor(code: string | null): { prefix: string | null; suffix: string | null } {
    const before = this.settings.symbolPosition() === 'before';
    return { prefix: before ? code : null, suffix: before ? null : code };
  }
}
