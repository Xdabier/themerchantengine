import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { STORE_CONFIG } from '../settings/store.config';
import {
  CURRENCIES,
  CURRENCY_CODES,
  currencyEntry,
  type CurrencyEntry,
} from './currencies.constants';
import type { UpdateEnabledCurrenciesDto } from './dto/update-currencies.dto';

const GROUP = 'storefront';
const KEY_ENABLED = 'enabledCurrencies';
const KEY_DEFAULT = 'defaultCurrency';

/**
 * Neutral defaults for a store nobody has configured yet (DR-31). The seed
 * writes `storefront.enabledCurrencies` and `storefront.defaultCurrency` from
 * the runtime config, and the CLI stepper does the same at install, so these
 * are only read on a database with no rows at all.
 */
const DEFAULT_DEFAULT = STORE_CONFIG.localization.currencyConfig.code;
const DEFAULT_ENABLED: readonly string[] = [DEFAULT_DEFAULT];

export interface CurrencyRow extends CurrencyEntry {
  enabled: boolean;
  isDefault: boolean;
}

export interface CurrenciesResult {
  data: CurrencyRow[];
  defaultCode: string | null;
}

/** What every admin surface needs to render money: the store currency + the enabled set. */
export interface StoreCurrency {
  code: string;
  symbol: string;
  decimalPlaces: number;
  enabled: string[];
}

const CURRENCY_CONFIG_KEY = 'currencyConfig';

interface StoredCurrencyConfig {
  code?: string;
  symbol?: string;
  decimalPlaces?: number;
}

@Injectable()
export class CurrenciesService {
  private readonly logger = new Logger(CurrenciesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async list(): Promise<CurrenciesResult> {
    const [enabledRow, defaultRow] = await Promise.all([
      this.prisma.storeSetting.findUnique({
        where: { group_key: { group: GROUP, key: KEY_ENABLED } },
      }),
      this.prisma.storeSetting.findUnique({
        where: { group_key: { group: GROUP, key: KEY_DEFAULT } },
      }),
    ]);

    const enabled = new Set<string>(
      Array.isArray(enabledRow?.value) &&
      (enabledRow.value as unknown[]).every((v) => typeof v === 'string')
        ? (enabledRow.value as string[])
        : DEFAULT_ENABLED,
    );
    // A stored code outside the catalogue is DISCARDED, not surfaced. That is
    // correct — the catalogue is the allow-list — but it used to be silent, and
    // silence is how a store ends up advertising a currency nobody chose: the
    // row says one code, the read says another, and nothing disagrees out loud.
    if (typeof defaultRow?.value === 'string' && !CURRENCY_CODES.has(defaultRow.value)) {
      this.logger.warn(
        `storefront.defaultCurrency is "${defaultRow.value}", which is not in the currency ` +
          `catalogue; falling back to ${DEFAULT_DEFAULT}. Add it to CURRENCIES to enable it.`,
      );
    }
    const defaultCode =
      typeof defaultRow?.value === 'string' && CURRENCY_CODES.has(defaultRow.value)
        ? defaultRow.value
        : DEFAULT_DEFAULT;

    return {
      data: CURRENCIES.map((c) => ({
        ...c,
        enabled: enabled.has(c.code),
        isDefault: c.code === defaultCode,
      })),
      defaultCode,
    };
  }

  /**
   * The store currency every admin screen formats money in, plus the enabled set.
   *
   * The code comes from the `storefront.defaultCurrency` row, not from
   * `localization.currencyConfig`: only the former is validated to be inside the
   * enabled set, and the admin's currency selects rely on `code ∈ enabled`. The
   * stored config supplies symbol / decimalPlaces, and only when its code agrees;
   * otherwise the catalogue does.
   */
  async getStore(): Promise<StoreCurrency> {
    const [{ data, defaultCode }, stored] = await Promise.all([
      this.list(),
      this.settings.get<StoredCurrencyConfig | undefined>(CURRENCY_CONFIG_KEY),
    ]);

    const code = defaultCode ?? DEFAULT_DEFAULT;
    const entry = currencyEntry(code);
    const agrees = stored?.code === code;

    return {
      code,
      symbol: (agrees ? stored?.symbol : undefined) ?? entry?.symbol ?? code,
      decimalPlaces: (agrees ? stored?.decimalPlaces : undefined) ?? entry?.decimalPlaces ?? 2,
      enabled: data.filter((c) => c.enabled).map((c) => c.code),
    };
  }

  async update(dto: UpdateEnabledCurrenciesDto): Promise<CurrenciesResult> {
    if (dto.enabled.length === 0) {
      throw new BadRequestException('At least one currency must remain enabled');
    }
    if (dto.defaultCode && !dto.enabled.includes(dto.defaultCode)) {
      throw new BadRequestException('Default currency must be in the enabled list');
    }

    await this.prisma.$transaction([
      this.prisma.storeSetting.upsert({
        where: { group_key: { group: GROUP, key: KEY_ENABLED } },
        create: { group: GROUP, key: KEY_ENABLED, value: dto.enabled },
        update: { value: dto.enabled },
      }),
      ...(dto.defaultCode
        ? [
            this.prisma.storeSetting.upsert({
              where: { group_key: { group: GROUP, key: KEY_DEFAULT } },
              create: { group: GROUP, key: KEY_DEFAULT, value: dto.defaultCode },
              update: { value: dto.defaultCode },
            }),
          ]
        : []),
    ]);

    // This picker is the single operator-facing currency editor, so it also owns
    // `localization.currencyConfig`. Without this the two sources drift and the
    // admin formats money in a currency the store no longer uses.
    if (dto.defaultCode) {
      const entry = currencyEntry(dto.defaultCode);
      if (entry) {
        await this.settings.update(CURRENCY_CONFIG_KEY, {
          code: entry.code,
          symbol: entry.symbol,
          decimalPlaces: entry.decimalPlaces,
        });
      }
    }

    this.logger.log(
      `update: enabled=${dto.enabled.length} default=${dto.defaultCode ?? '(unchanged)'}`,
    );
    // The roster rows live outside the settings registry, so the settings
    // write above only fires when a default code was sent; the runtime config
    // reads the roster on every path.
    this.settings.emitStoreConfigUpdated([GROUP]);
    return this.list();
  }
}
