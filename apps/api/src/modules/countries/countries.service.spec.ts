import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CountriesService } from './countries.service';

function makePrismaMock() {
  return {
    storeSetting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
}

/** The configured market: the store ships to LY and sits in LY. */
const settings = {
  get: jest.fn(async (key: string) =>
    key === 'areaServed' ? ['LY'] : key === 'addressCountry' ? 'LY' : undefined,
  ),
};

describe('CountriesService', () => {
  let service: CountriesService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CountriesService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettingsService, useValue: settings },
      ],
    }).compile();
    service = module.get(CountriesService);
  });

  describe('list', () => {
    it('falls back to defaults (TN enabled + default) when no rows exist', async () => {
      prisma.storeSetting.findUnique.mockResolvedValue(null);
      const res = await service.list();
      const tn = res.data.find((c) => c.code === 'LY');
      expect(tn?.enabled).toBe(true);
      expect(tn?.isDefault).toBe(true);
      expect(res.defaultCode).toBe('LY');
    });

    it('overlays persisted enabled set', async () => {
      prisma.storeSetting.findUnique.mockImplementation(
        ({ where }: { where: { group_key: { key: string } } }) => {
          if (where.group_key.key === 'enabledCountries') {
            return Promise.resolve({ value: ['QA', 'AE'] });
          }
          return Promise.resolve(null);
        },
      );
      const res = await service.list();
      const ae = res.data.find((c) => c.code === 'AE');
      expect(ae?.enabled).toBe(true);
      const sa = res.data.find((c) => c.code === 'SA');
      expect(sa?.enabled).toBe(false);
    });

    it('ignores malformed persisted rows', async () => {
      prisma.storeSetting.findUnique.mockResolvedValue({ value: 'not-an-array' });
      const res = await service.list();
      expect(res.data.find((c) => c.code === 'LY')?.enabled).toBe(true);
    });
  });

  describe('update', () => {
    it('rejects empty enabled list', async () => {
      await expect(service.update({ enabled: [] })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects default outside enabled set', async () => {
      await expect(service.update({ enabled: ['MA'], defaultCode: 'AE' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('upserts the enabled + default rows then re-reads', async () => {
      prisma.storeSetting.upsert.mockResolvedValue({});
      prisma.storeSetting.findUnique.mockResolvedValue(null);
      await service.update({ enabled: ['MA', 'AE'], defaultCode: 'AE' });
      expect(prisma.storeSetting.upsert).toHaveBeenCalledTimes(2);
    });

    it('omits the default upsert when defaultCode is undefined', async () => {
      prisma.storeSetting.upsert.mockResolvedValue({});
      prisma.storeSetting.findUnique.mockResolvedValue(null);
      await service.update({ enabled: ['QA', 'AE'] });
      expect(prisma.storeSetting.upsert).toHaveBeenCalledTimes(1);
    });
  });
});
