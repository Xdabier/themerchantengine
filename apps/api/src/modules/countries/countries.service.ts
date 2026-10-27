import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { COUNTRIES, COUNTRY_CODES } from './countries.constants';
import type { UpdateEnabledCountriesDto } from './dto/update-countries.dto';

const GROUP = 'storefront';
const KEY_ENABLED = 'enabledCountries';
const KEY_DEFAULT = 'defaultCountry';

/**
 * Defaults: neutral defaults until the seed or the stepper writes the
 * store's country rows from the runtime config (DR-31); kept in step with
 * an operator says otherwise. Keeps the first-run storefront usable
 * without requiring a one-off migration.
 *
 * These are load-bearing for tax, not only for a country dropdown: the
 * shipping address country is the argument to `TaxService.calculateTax`, so a
 * store defaulting to the wrong country resolves the wrong VAT zone.
 */
/**
 * With no roster rows yet, the enabled set is the store's configured market:
 * `business.areaServed`, else its own country, else nothing (DR-31). The seed
 * and the CLI stepper write the rows from the same config, so this branch
 * only runs on a database nobody has configured.
 */

export interface CountryRow {
  code: string;
  name: string;
  region: string;
  emoji: string;
  enabled: boolean;
  isDefault: boolean;
}

export interface CountriesResult {
  data: CountryRow[];
  defaultCode: string | null;
}

@Injectable()
export class CountriesService {
  private readonly logger = new Logger(CountriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async list(): Promise<CountriesResult> {
    const [enabledRow, defaultRow] = await Promise.all([
      this.prisma.storeSetting.findUnique({
        where: { group_key: { group: GROUP, key: KEY_ENABLED } },
      }),
      this.prisma.storeSetting.findUnique({
        where: { group_key: { group: GROUP, key: KEY_DEFAULT } },
      }),
    ]);

    const configured = await this.configuredMarket();
    const enabled = new Set<string>(
      Array.isArray(enabledRow?.value) &&
      (enabledRow.value as unknown[]).every((v) => typeof v === 'string')
        ? (enabledRow.value as string[])
        : configured.enabled,
    );
    const defaultCode =
      typeof defaultRow?.value === 'string' && COUNTRY_CODES.has(defaultRow.value)
        ? defaultRow.value
        : configured.defaultCode;

    return {
      data: COUNTRIES.map((c) => ({
        ...c,
        enabled: enabled.has(c.code),
        isDefault: c.code === defaultCode,
      })),
      defaultCode,
    };
  }

  private async configuredMarket(): Promise<{ enabled: string[]; defaultCode: string | null }> {
    const [areaServed, country] = await Promise.all([
      this.settings.get<unknown>('areaServed'),
      this.settings.get<unknown>('addressCountry'),
    ]);
    const home = typeof country === 'string' && COUNTRY_CODES.has(country) ? country : null;
    const served = Array.isArray(areaServed)
      ? areaServed.filter((c): c is string => typeof c === 'string' && COUNTRY_CODES.has(c))
      : [];
    const enabled = served.length > 0 ? served : home ? [home] : [];
    return { enabled, defaultCode: home && enabled.includes(home) ? home : (enabled[0] ?? null) };
  }

  async update(dto: UpdateEnabledCountriesDto): Promise<CountriesResult> {
    if (dto.enabled.length === 0) {
      throw new BadRequestException('At least one country must remain enabled');
    }
    if (dto.defaultCode && !dto.enabled.includes(dto.defaultCode)) {
      throw new BadRequestException('Default country must be in the enabled list');
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

    this.logger.log(
      `update: enabled=${dto.enabled.length} default=${dto.defaultCode ?? '(unchanged)'}`,
    );
    return this.list();
  }
}
