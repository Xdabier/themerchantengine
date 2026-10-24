import {
  STORE_CONFIG_FIXTURE_IDS,
  loadStoreConfigFixture,
  runtimeConfigOfFixture,
} from '../store-config-fixtures';
import { NEUTRAL_STORE_CONFIG } from './neutral-store-config';
import { isConfiguredStore, storeConfigFromSettingRows } from './store-config-from-rows';
import { storeConfigSettingRows } from './store-config-rows';

describe('storeConfigFromSettingRows', () => {
  it('reads the neutral config from an empty database', () => {
    expect(storeConfigFromSettingRows([])).toEqual(NEUTRAL_STORE_CONFIG);
    expect(isConfiguredStore(storeConfigFromSettingRows([]))).toBe(false);
  });

  it.each(STORE_CONFIG_FIXTURE_IDS)('round-trips the %s fixture through its rows', (id) => {
    const runtime = runtimeConfigOfFixture(loadStoreConfigFixture(id));
    const back = storeConfigFromSettingRows(storeConfigSettingRows(runtime));
    expect(back).toEqual(runtime);
    expect(isConfiguredStore(back)).toBe(true);
  });

  it('falls back per field for a malformed row', () => {
    const config = storeConfigFromSettingRows([
      { group: 'general', key: 'storeName', value: 'not a translatable' },
      { group: 'money', key: 'vatRate', value: '19' },
      { group: 'business', key: 'areaServed', value: ['FR', 3] },
      { group: 'business', key: 'addressCountry', value: 'FR' },
    ]);
    expect(config.identity.storeName).toEqual(NEUTRAL_STORE_CONFIG.identity.storeName);
    expect(config.money.vatRate).toBe(0);
    expect(config.identity.areaServed).toEqual(['FR']);
    expect(isConfiguredStore(config)).toBe(true);
  });
});
