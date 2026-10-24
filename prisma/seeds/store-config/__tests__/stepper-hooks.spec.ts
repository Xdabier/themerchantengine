import { describe, expect, it, vi } from 'vitest';
import {
  loadStoreConfigFixture,
  runtimeConfigOfFixture,
} from '../../../../libs/shared/common/src/store-config-fixtures';
import { storeConfigSettingRows } from '../../../../libs/shared/common/src/store-config/store-config-rows';
import { seedLogoUrl, seedStoreConfig } from '../../store-config-fixture';
import {
  DEFAULT_FLAT_RATE,
  DOMESTIC_SHIPPING_METHOD_ID,
  seedFlatRate,
  seedShipping,
} from '../shipping';

/**
 * The hooks the install stepper drives through `prisma db seed` (plan E4.4):
 * the config file's rows, the logo URL, and the shipping rate the operator
 * entered in place of the placeholder.
 */
function makePrisma(existingLogo: string | null = null) {
  const updateMany = () => vi.fn(async () => ({ count: 0 }));
  return {
    storeSetting: {
      upsert: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => (existingLogo === null ? null : { value: existingLogo })),
    },
    shippingZone: { upsert: vi.fn(async () => ({})), updateMany: updateMany() },
    shippingMethod: { upsert: vi.fn(async () => ({})), updateMany: updateMany() },
  };
}

const demo = runtimeConfigOfFixture(loadStoreConfigFixture('demo'));

describe('seedStoreConfig', () => {
  it('upserts every row of the shared mapping and reports the count', async () => {
    const prisma = makePrisma();
    const written = await seedStoreConfig(prisma as never, demo);
    const expected = storeConfigSettingRows(demo);
    expect(written).toBe(expected.length);
    expect(prisma.storeSetting.upsert).toHaveBeenCalledTimes(expected.length);
    const keys = prisma.storeSetting.upsert.mock.calls.map(
      (c) =>
        `${(c[0] as { create: { group: string; key: string } }).create.group}.${(c[0] as { create: { key: string } }).create.key}`,
    );
    expect(keys).toContain('domains.api');
    expect(keys).toContain('localization.defaultLocale');
  });
});

describe('seedLogoUrl', () => {
  it('writes the logo once and never over an operator value', async () => {
    const fresh = makePrisma(null);
    await expect(seedLogoUrl(fresh as never, 'https://cdn.example/logo.png')).resolves.toBe(true);
    expect(fresh.storeSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { group: 'appearance', key: 'logoUrl', value: 'https://cdn.example/logo.png' },
      }),
    );
    const empty = makePrisma('');
    await expect(seedLogoUrl(empty as never, 'https://cdn.example/logo.png')).resolves.toBe(true);
    const owned = makePrisma('https://cdn.example/their-logo.png');
    await expect(seedLogoUrl(owned as never, 'https://cdn.example/logo.png')).resolves.toBe(false);
    expect(owned.storeSetting.upsert).not.toHaveBeenCalled();
  });
});

describe('seedFlatRate and the shipping create', () => {
  it('reads the stepper rate, keeps the placeholder when unset, refuses garbage', () => {
    expect(seedFlatRate({})).toBe(DEFAULT_FLAT_RATE);
    expect(seedFlatRate({ SEED_SHIPPING_FLAT_RATE: '' })).toBe(DEFAULT_FLAT_RATE);
    expect(seedFlatRate({ SEED_SHIPPING_FLAT_RATE: '7.5' })).toBe(7.5);
    expect(seedFlatRate({ SEED_SHIPPING_FLAT_RATE: '0' })).toBe(0);
    expect(() => seedFlatRate({ SEED_SHIPPING_FLAT_RATE: 'ten' })).toThrow(/not a rate/);
    expect(() => seedFlatRate({ SEED_SHIPPING_FLAT_RATE: '-1' })).toThrow(/not a rate/);
  });

  it('plants the entered rate on create and still never carries it on update', async () => {
    const prisma = makePrisma();
    const result = await seedShipping(prisma as never, demo, { flatRate: 7.5 });
    expect(result?.price).toBe(7.5);
    const call = prisma.shippingMethod.upsert.mock.calls.find(
      (c) => (c[0] as { where: { id: string } }).where.id === DOMESTIC_SHIPPING_METHOD_ID,
    );
    const args = call?.[0] as { create: { price: number }; update: Record<string, unknown> };
    expect(args.create.price).toBe(7.5);
    expect(args.update).not.toHaveProperty('price');
  });
});
