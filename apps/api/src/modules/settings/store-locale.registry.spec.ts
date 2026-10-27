import { Test } from '@nestjs/testing';
import { NEUTRAL_LOCALE_SET, storeLocales } from '@common/locale';
import { SettingsService } from './settings.service';
import { StoreLocaleRegistry } from './store-locale.registry';

describe('StoreLocaleRegistry', () => {
  const settings = { getLocaleSet: jest.fn() };
  let registry: StoreLocaleRegistry;

  beforeEach(async () => {
    jest.clearAllMocks();
    storeLocales.set(NEUTRAL_LOCALE_SET);
    const module = await Test.createTestingModule({
      providers: [StoreLocaleRegistry, { provide: SettingsService, useValue: settings }],
    }).compile();
    registry = module.get(StoreLocaleRegistry);
  });

  afterAll(() => storeLocales.set(NEUTRAL_LOCALE_SET));

  it('loads the store locale set at boot into the shared snapshot', async () => {
    settings.getLocaleSet.mockResolvedValue({
      supportedLocales: ['ar', 'en'],
      defaultLocale: 'ar',
      rtlLocales: ['ar'],
      timezone: 'UTC',
    });
    await registry.onModuleInit();
    expect(registry.current()).toEqual({
      supportedLocales: ['ar', 'en'],
      defaultLocale: 'ar',
      rtlLocales: ['ar'],
      timezone: 'UTC',
    });
    expect(storeLocales.current().defaultLocale).toBe('ar');
    expect(registry.direction('ar')).toBe('rtl');
    expect(registry.isRtl('en')).toBe(false);
  });

  it('serves a three locale set with one right-to-left locale', async () => {
    settings.getLocaleSet.mockResolvedValue({
      supportedLocales: ['fr', 'en', 'ar'],
      defaultLocale: 'fr',
      rtlLocales: ['ar'],
      timezone: 'UTC',
    });
    await registry.onModuleInit();
    expect(registry.current().supportedLocales).toEqual(['fr', 'en', 'ar']);
    expect(registry.direction('fr')).toBe('ltr');
    expect(registry.direction('en')).toBe('ltr');
    expect(registry.direction('ar')).toBe('rtl');
    expect(storeLocales.isSupported('ar')).toBe(true);
    expect(storeLocales.isSupported('de')).toBe(false);
  });

  it('refreshes on store-config.updated', async () => {
    settings.getLocaleSet.mockResolvedValueOnce({
      supportedLocales: ['fr', 'en'],
      defaultLocale: 'en',
      rtlLocales: [],
      timezone: 'UTC',
    });
    await registry.onStoreConfigUpdated();
    expect(registry.current().defaultLocale).toBe('en');
  });

  it('keeps the last good snapshot when the database is unavailable', async () => {
    settings.getLocaleSet.mockResolvedValueOnce({
      supportedLocales: ['fr', 'en', 'ar'],
      defaultLocale: 'fr',
      rtlLocales: ['ar'],
      timezone: 'UTC',
    });
    await registry.refresh();
    settings.getLocaleSet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(registry.refresh()).resolves.toEqual({
      supportedLocales: ['fr', 'en', 'ar'],
      defaultLocale: 'fr',
      rtlLocales: ['ar'],
      timezone: 'UTC',
    });
  });

  it('clips a set the settings row left inconsistent', async () => {
    settings.getLocaleSet.mockResolvedValueOnce({
      supportedLocales: ['en'],
      defaultLocale: 'fr',
      rtlLocales: ['ar'],
      timezone: 'UTC',
    });
    await registry.refresh();
    expect(registry.current()).toEqual({
      supportedLocales: ['en'],
      defaultLocale: 'en',
      rtlLocales: [],
      timezone: 'UTC',
    });
  });
});
