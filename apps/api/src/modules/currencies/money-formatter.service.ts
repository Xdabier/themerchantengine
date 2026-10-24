import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { type MoneyConfig, storeMoney } from '@common/money';
import { SettingsService } from '../settings/settings.service';
import { SETTINGS_GROUPS } from '../settings/settings.constants';
import { STORE_CONFIG_UPDATED_EVENT } from '../settings/settings.events';
import { STORE_CONFIG } from '../settings/store.config';
import { CurrenciesService } from './currencies.service';

/**
 * Keeps the process-wide money snapshot (`storeMoney` in the shared lib)
 * equal to the runtime config (plan E1.4.1): the store currency from the
 * currencies roster, its symbol and display precision from `currencyConfig`,
 * and the `money` group for the symbol side, the separators, the tax mention
 * and the VAT rate.
 *
 * Loaded once at boot and replaced on every `store-config.updated` event, so
 * an order confirmation rendered a moment after an operator changes the
 * separators already reads the new form, with no settings read per amount.
 * A load that fails keeps the last good snapshot.
 *
 * Inject this where a request scope exists; import `storeMoney` where none
 * does (the mail renderer, the seed). Both read the same object.
 */
const REFRESH_INTERVAL_MS = 60_000;

@Injectable()
export class MoneyFormatterService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private readonly logger = new Logger(MoneyFormatterService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly currencies: CurrenciesService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
    // The event only reaches the process that served the write; a second API
    // instance re-reads on a timer so it is never more than a minute behind.
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  @OnEvent(STORE_CONFIG_UPDATED_EVENT, { async: true })
  async onStoreConfigUpdated(): Promise<void> {
    await this.refresh();
  }

  config(): MoneyConfig {
    return storeMoney.current();
  }

  /** Formats in the store currency, or in the row's own when one is given. */
  format(value: Prisma.Decimal.Value | null | undefined, currencyCode?: string | null): string {
    return storeMoney.format(value, currencyCode);
  }

  /** `HT`, `TTC` or an empty string, for the copy beside a catalogue price. */
  taxLabel(): string {
    return storeMoney.taxLabel();
  }

  /** The ISO 4217 code every new order and gift card is written in. */
  currencyCode(): string {
    return storeMoney.currencyCode();
  }

  /** Reloads the snapshot from the settings and the roster; keeps the last good one on failure. */
  async refresh(): Promise<MoneyConfig> {
    try {
      const [currency, money] = await Promise.all([
        this.currencies.getStore(),
        this.settings.getGroup(SETTINGS_GROUPS.MONEY),
      ]);
      const defaults = STORE_CONFIG.money;
      storeMoney.set({
        currencyCode: currency.code,
        symbol: currency.symbol,
        displayPrecision: currency.decimalPlaces,
        symbolPosition: str(
          money['symbolPosition'],
          defaults.symbolPosition,
        ) as MoneyConfig['symbolPosition'],
        decimalSeparator: str(money['decimalSeparator'], defaults.decimalSeparator),
        thousandsSeparator: str(money['thousandsSeparator'], defaults.thousandsSeparator),
        taxDisplay: str(money['taxDisplay'], defaults.taxDisplay) as MoneyConfig['taxDisplay'],
        vatRate: typeof money['vatRate'] === 'number' ? money['vatRate'] : defaults.vatRate,
      });
    } catch (err) {
      this.logger.warn(
        `Money config reload failed, keeping the last one: ${(err as Error).message}`,
      );
    }
    return storeMoney.current();
  }
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}
