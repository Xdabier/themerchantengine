import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CurrenciesService } from './currencies.service';

function makePrismaMock() {
  return {
    storeSetting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
}

function makeSettingsMock() {
  return {
    get: jest.fn().mockResolvedValue({ code: 'AED', symbol: 'د.إ', decimalPlaces: 2 }),
    update: jest.fn().mockResolvedValue(undefined),
    emitStoreConfigUpdated: jest.fn(),
  };
}

describe('CurrenciesService', () => {
  let service: CurrenciesService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let settings: ReturnType<typeof makeSettingsMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    settings = makeSettingsMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CurrenciesService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettingsService, useValue: settings },
      ],
    }).compile();
    service = module.get(CurrenciesService);
  });

  describe('list', () => {
    it('falls back to the neutral USD default when no rows exist', async () => {
      // The seed and the CLI stepper write the store currency from the runtime
      // config (DR-31); the neutral default is only read on an empty database.
      prisma.storeSetting.findUnique.mockResolvedValue(null);
      const res = await service.list();
      const usd = res.data.find((c) => c.code === 'USD');
      expect(usd?.enabled).toBe(true);
      expect(usd?.isDefault).toBe(true);
      expect(res.defaultCode).toBe('USD');
      // The neutral default must be IN the catalogue, or the membership test at
      // `list()` discards any stored row naming it and silently substitutes
      // the service default. That was the whole failure mode before D4.
      expect(usd).toBeDefined();
      expect(usd?.decimalPlaces).toBe(2);
    });

    it('overlays persisted enabled set', async () => {
      prisma.storeSetting.findUnique.mockImplementation(
        ({ where }: { where: { group_key: { key: string } } }) => {
          if (where.group_key.key === 'enabledCurrencies') {
            return Promise.resolve({ value: ['LYD', 'USD', 'EUR'] });
          }
          return Promise.resolve(null);
        },
      );
      const res = await service.list();
      const usd = res.data.find((c) => c.code === 'USD');
      expect(usd?.enabled).toBe(true);
      const jpy = res.data.find((c) => c.code === 'JPY');
      expect(jpy?.enabled).toBe(false);
    });

    it('ignores malformed persisted rows', async () => {
      prisma.storeSetting.findUnique.mockResolvedValue({ value: 'bogus' });
      const res = await service.list();
      expect(res.data.find((c) => c.code === 'USD')?.enabled).toBe(true);
    });
  });

  describe('update', () => {
    it('rejects empty enabled list', async () => {
      await expect(service.update({ enabled: [] })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects default outside enabled set', async () => {
      await expect(service.update({ enabled: ['LYD'], defaultCode: 'USD' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('upserts the enabled + default rows then re-reads', async () => {
      prisma.storeSetting.upsert.mockResolvedValue({});
      prisma.storeSetting.findUnique.mockResolvedValue(null);
      await service.update({ enabled: ['LYD', 'USD'], defaultCode: 'USD' });
      expect(prisma.storeSetting.upsert).toHaveBeenCalledTimes(2);
    });

    it('omits the default upsert when defaultCode is undefined', async () => {
      prisma.storeSetting.upsert.mockResolvedValue({});
      prisma.storeSetting.findUnique.mockResolvedValue(null);
      await service.update({ enabled: ['LYD', 'USD'] });
      expect(prisma.storeSetting.upsert).toHaveBeenCalledTimes(1);
    });

    it('syncs localization.currencyConfig to the new default currency', async () => {
      prisma.storeSetting.upsert.mockResolvedValue({});
      prisma.storeSetting.findUnique.mockResolvedValue(null);

      await service.update({ enabled: ['LYD', 'AED'], defaultCode: 'AED' });

      expect(settings.update).toHaveBeenCalledWith('currencyConfig', {
        code: 'AED',
        symbol: 'د.إ',
        decimalPlaces: 2,
      });
    });

    it('leaves currencyConfig alone when no default is supplied', async () => {
      prisma.storeSetting.upsert.mockResolvedValue({});
      prisma.storeSetting.findUnique.mockResolvedValue(null);

      await service.update({ enabled: ['LYD', 'AED'] });

      expect(settings.update).not.toHaveBeenCalled();
    });
  });

  // ── getStore ───────────────────────────────────────────────────────────────

  describe('getStore', () => {
    it('reads the catalogue when the stored currencyConfig names another code', async () => {
      // No default-currency row, so the neutral USD is the store currency;
      // the stored AED config disagrees with it and supplies nothing.
      prisma.storeSetting.findUnique.mockImplementation(
        ({ where }: { where: { group_key: { key: string } } }) => {
          if (where.group_key.key === 'enabledCurrencies') {
            return Promise.resolve({ value: ['LYD', 'AED'] });
          }
          return Promise.resolve(null);
        },
      );

      const res = await service.getStore();

      expect(res).toEqual({
        code: 'USD',
        symbol: '$',
        decimalPlaces: 2,
        enabled: ['LYD', 'AED'],
      });
    });

    /**
     * `storefront.defaultCurrency` is the operator-facing picker and is validated to
     * be inside the enabled set; `localization.currencyConfig` is not. Preferring the
     * picker keeps the invariant `code ∈ enabled`, which the admin gift-card currency
     * select depends on. The stored config only supplies symbol / decimals, and only
     * when its code agrees.
     */
    it('prefers the default-currency row over a stale stored config', async () => {
      settings.get.mockResolvedValue({ code: 'USD', symbol: '$', decimalPlaces: 2 });
      prisma.storeSetting.findUnique.mockImplementation(
        ({ where }: { where: { group_key: { key: string } } }) => {
          if (where.group_key.key === 'defaultCurrency') {
            return Promise.resolve({ value: 'AED' });
          }
          if (where.group_key.key === 'enabledCurrencies') {
            return Promise.resolve({ value: ['LYD', 'AED'] });
          }
          return Promise.resolve(null);
        },
      );

      const res = await service.getStore();

      expect(res.code).toBe('AED');
      expect(res.symbol).toBe('د.إ');
      expect(res.decimalPlaces).toBe(2);
    });

    it('falls back to the catalogue when no config is stored', async () => {
      settings.get.mockResolvedValue(undefined);
      prisma.storeSetting.findUnique.mockResolvedValue(null);

      const res = await service.getStore();

      expect(res).toEqual({
        code: 'USD',
        symbol: '$',
        decimalPlaces: 2,
        enabled: ['USD'],
      });
    });
  });
});
