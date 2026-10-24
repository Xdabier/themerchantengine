import { describe, expect, it } from 'vitest';
import { SETTINGS_KEYS } from '../../apps/api/src/modules/settings/settings.constants';
import {
  STORE_CONFIG_FIXTURE_IDS,
  loadStoreConfigFixture,
} from '../../libs/shared/common/src/store-config-fixtures';
import { CURRENCY_CODES } from '../../libs/shared/common/src/constants/currencies.constants';
import { CURRENCY_ROWS, storeConfigFixtureSettingRows } from '../seeds/store-config-fixture';

describe('storeConfigFixtureSettingRows', () => {
  it.each(STORE_CONFIG_FIXTURE_IDS)('%s maps only to registered setting keys', (id) => {
    const rows = storeConfigFixtureSettingRows(loadStoreConfigFixture(id));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      if (row.group === CURRENCY_ROWS.group) {
        expect([CURRENCY_ROWS.defaultKey, CURRENCY_ROWS.enabledKey]).toContain(row.key);
        continue;
      }
      const keys = (SETTINGS_KEYS as Record<string, readonly string[]>)[row.group];
      expect(keys, `${row.group} is not a settings group`).toBeDefined();
      expect(keys, `${row.group}.${row.key} is not registered`).toContain(row.key);
    }
  });

  it.each(STORE_CONFIG_FIXTURE_IDS)('%s uses a currency the catalogue knows', (id) => {
    // A code outside CURRENCIES is discarded by CurrenciesService.getStore and
    // the store silently falls back to the catalogue default.
    const fixture = loadStoreConfigFixture(id);
    expect(CURRENCY_CODES.has(fixture.money.currencyCode)).toBe(true);
    const rows = storeConfigFixtureSettingRows(fixture);
    expect(rows.find((r) => r.key === CURRENCY_ROWS.defaultKey)?.value).toBe(
      fixture.money.currencyCode,
    );
    expect(rows.find((r) => r.key === CURRENCY_ROWS.enabledKey)?.value).toEqual([
      fixture.money.currencyCode,
    ]);
  });

  it('writes the gulf-rtl currency, locale set and Arabic store name', () => {
    const rows = storeConfigFixtureSettingRows(loadStoreConfigFixture('gulf-rtl'));
    const byKey = Object.fromEntries(rows.map((r) => [`${r.group}.${r.key}`, r.value]));
    expect(byKey['localization.currencyConfig']).toEqual({
      code: 'AED',
      symbol: 'د.إ',
      decimalPlaces: 2,
    });
    expect(byKey['localization.supportedLocales']).toEqual(['ar', 'en']);
    expect(byKey['localization.defaultLocale']).toBe('ar');
    expect(byKey['general.storeName']).toMatchObject({ ar: 'سوق المرسى', en: 'Marsa Market' });
    expect(byKey['business.tradingName']).toEqual({ default: 'marsa', ar: 'marsa', en: 'marsa' });
    expect(byKey['business.addressCountry']).toBe('AE');
  });

  it('writes the maghreb-ltr three-decimal currency', () => {
    const rows = storeConfigFixtureSettingRows(loadStoreConfigFixture('maghreb-ltr'));
    const currency = rows.find((r) => r.key === 'currencyConfig')?.value;
    expect(currency).toEqual({ code: 'LYD', symbol: 'LD', decimalPlaces: 3 });
  });
});
