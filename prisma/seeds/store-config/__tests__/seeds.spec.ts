import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { registryLocaleCodes } from '../../../../libs/shared/common/src/locale/locale-registry';
import { registerScratchLocale } from '../../../../libs/shared/common/src/locale/test-locale-sets';
import { NEUTRAL_STORE_CONFIG } from '../../../../libs/shared/common/src/store-config/neutral-store-config';
import {
  loadStoreConfigFixture,
  runtimeConfigOfFixture,
  type StoreRuntimeConfig,
} from '../../../../libs/shared/common/src/store-config-fixtures';
import {
  CATCH_ALL_TAX_CLASS_ID,
  CATCH_ALL_TAX_ZONE_ID,
  DOMESTIC_TAX_CLASS_ID,
  DOMESTIC_TAX_ZONE_ID,
  SEED_TAX_CLASS_ID_PREFIX,
  SEED_TAX_ZONE_ID_PREFIX,
  seedTax,
} from '../tax';
import {
  DEFAULT_FLAT_RATE,
  DOMESTIC_SHIPPING_METHOD_ID,
  DOMESTIC_SHIPPING_ZONE_ID,
  SEED_SHIPPING_METHOD_ID_PREFIXES,
  SEED_SHIPPING_ZONE_ID_PREFIXES,
  seedShipping,
} from '../shipping';
import { COD_PAYMENT_METHOD_CODE, seedPaymentMethods } from '../payment-methods';

/**
 * The seeds that read the runtime config, on the path production actually
 * runs. The install stepper's seed step runs `SEED_SCOPE=notifications-rbac`
 * on every install and re-run (the retired deploy pipeline did the same), and that branch once planted shipping and NO tax zone at
 * all, so production shipped untaxed. Nothing caught it because neither seed
 * path had a test.
 *
 * The properties pinned here are the ones whose absence is silent:
 *
 *  - every upsert carries a REAL `update` payload. An `update: {}` upsert
 *    matches by its hardcoded id, applies nothing, and reports success while
 *    the old rate stays live. A `create`-only assertion cannot see that, so
 *    these tests assert on the `update` half specifically.
 *  - the earlier generations' zones are retired, not merely out-ranked.
 *  - an unmatched country falls through to whichever zone holds `isDefault`,
 *    so the ZERO-RATED catch-all is the default and the domestic zone matches
 *    by its country list. Giving the domestic zone both would quote its rate
 *    on every destination the store does not model.
 *  - the neutral config seeds nothing that names a country, because a fresh
 *    engine has none.
 */

type Call = {
  where: Record<string, unknown>;
  update?: Record<string, unknown>;
  create?: Record<string, unknown>;
};

type Args = Record<string, unknown>;

function makePrisma(existingCod = false) {
  const updateMany = () => vi.fn(async (_args: Args) => ({ count: 0 }));
  const taxZone = {
    upsert: vi.fn(async (a: Call) => ({ id: a.where.id })),
    updateMany: updateMany(),
  };
  const taxClass = {
    upsert: vi.fn(async (a: Call) => ({ id: a.where.id })),
    updateMany: updateMany(),
  };
  const productType = { updateMany: updateMany() };
  const shippingZone = { upsert: vi.fn(async (_args: Args) => ({})), updateMany: updateMany() };
  const shippingMethod = { upsert: vi.fn(async (_args: Args) => ({})), updateMany: updateMany() };
  const paymentMethod = {
    findUnique: vi.fn(async (_args: Args) => (existingCod ? { id: 'pm-cod' } : null)),
    create: vi.fn(async (_args: Args) => ({})),
  };
  return { taxZone, taxClass, productType, shippingZone, shippingMethod, paymentMethod };
}

function upsertFor(mock: Mock, id: string): Call {
  const call = mock.mock.calls.find((c) => (c[0] as Call).where.id === id);
  if (!call) throw new Error(`no upsert for ${id}`);
  return call[0] as Call;
}

function upsertedIds(mock: Mock): string[] {
  return mock.mock.calls.map((c) => (c[0] as Call).where.id as string);
}

const gulf = runtimeConfigOfFixture(loadStoreConfigFixture('gulf-rtl'));
const maghreb = runtimeConfigOfFixture(loadStoreConfigFixture('maghreb-ltr'));

const fixtures: Array<{ label: string; config: StoreRuntimeConfig }> = [
  { label: 'gulf-rtl', config: gulf },
  { label: 'maghreb-ltr', config: maghreb },
];

describe('seedTax', () => {
  describe.each(fixtures)('with the $label fixture', ({ config }) => {
    it('seeds the domestic zone at the config rate, matched by the config country', async () => {
      const prisma = makePrisma();
      const result = await seedTax(prisma as never, config);

      const domestic = upsertFor(prisma.taxZone.upsert, DOMESTIC_TAX_ZONE_ID);
      const country = config.identity.address.country;
      expect(domestic.create).toMatchObject({ countries: [country], rate: config.money.vatRate });
      expect(domestic.update).toMatchObject({ countries: [country], rate: config.money.vatRate });
      expect(domestic.create?.name).toMatchObject({ default: 'Domestic VAT', en: 'Domestic VAT' });
      expect(result.standardClassId).toBe(DOMESTIC_TAX_CLASS_ID);
    });

    it('carries a real update payload on every upsert, not `update: {}`', async () => {
      const prisma = makePrisma();
      await seedTax(prisma as never, config);

      for (const call of [
        ...prisma.taxZone.upsert.mock.calls,
        ...prisma.taxClass.upsert.mock.calls,
      ]) {
        const arg = call[0] as Call;
        expect(Object.keys(arg.update ?? {}).length).toBeGreaterThan(0);
      }
      // And specifically: re-running must be able to CORRECT a stale rate.
      expect(upsertFor(prisma.taxClass.upsert, DOMESTIC_TAX_CLASS_ID).update).toMatchObject({
        rate: config.money.vatRate,
      });
    });

    it('makes the zero-rated catch-all the only default zone', async () => {
      const prisma = makePrisma();
      await seedTax(prisma as never, config);

      const zones = prisma.taxZone.upsert.mock.calls.map((c) => (c[0] as Call).create ?? {});
      const defaults = zones.filter((z) => z['isDefault'] === true);
      expect(defaults).toHaveLength(1);
      // The default must be the zone no country match can ever reach.
      expect(defaults[0]).toMatchObject({ countries: [], rate: 0 });
      // And every zone that carries countries must NOT be the default, or it
      // swallows the destinations it does not list.
      for (const zone of zones.filter((z) => (z['countries'] as string[]).length > 0)) {
        expect(zone['isDefault']).toBe(false);
      }
      expect(upsertFor(prisma.taxZone.upsert, CATCH_ALL_TAX_ZONE_ID).update).toMatchObject({
        countries: [],
        rate: 0,
        isDefault: true,
      });
    });
  });

  it('pins the two fixtures to the rates their scenarios describe', () => {
    expect(gulf.identity.address.country).toBe('AE');
    expect(gulf.money.vatRate).toBe(0.05);
    expect(maghreb.identity.address.country).toBe('LY');
    expect(maghreb.money.vatRate).toBe(0.19);
  });

  it('seeds no domestic zone for the neutral config, only the catch-all', async () => {
    const prisma = makePrisma();
    const result = await seedTax(prisma as never, NEUTRAL_STORE_CONFIG);

    expect(upsertedIds(prisma.taxZone.upsert)).toEqual([CATCH_ALL_TAX_ZONE_ID]);
    expect(upsertedIds(prisma.taxClass.upsert)).toEqual([CATCH_ALL_TAX_CLASS_ID]);
    expect(result.standardClassId).toBe(CATCH_ALL_TAX_CLASS_ID);
    // A config that names no country says nothing about the store, so nothing
    // an earlier run or an operator created is retired or repointed.
    expect(prisma.taxZone.updateMany).not.toHaveBeenCalled();
    expect(prisma.taxClass.updateMany).not.toHaveBeenCalled();
    expect(prisma.productType.updateMany).not.toHaveBeenCalled();
  });

  it('retires every other seed-planted zone by soft-delete, since TaxClass restricts', async () => {
    // The earlier generations wrote their ids under the same prefix, so a
    // prefix sweep that spares the two live ids reaches all of them without
    // this module having to name them. Operator rows carry cuids and are
    // never matched.
    const prisma = makePrisma();
    await seedTax(prisma as never, gulf);

    expect(SEED_TAX_ZONE_ID_PREFIX).toBe('taxzone-');
    expect(SEED_TAX_CLASS_ID_PREFIX).toBe('taxclass-');
    expect(prisma.taxZone.updateMany).toHaveBeenCalledWith({
      where: {
        id: { startsWith: 'taxzone-', notIn: [CATCH_ALL_TAX_ZONE_ID, DOMESTIC_TAX_ZONE_ID] },
        deletedAt: null,
      },
      data: { isActive: false, isDefault: false, deletedAt: expect.any(Date) },
    });
    // Their classes cannot be soft-deleted: they lose the default flag and the
    // product types that still point at one move to the live standard class.
    const staleClasses = {
      startsWith: 'taxclass-',
      notIn: [CATCH_ALL_TAX_CLASS_ID, DOMESTIC_TAX_CLASS_ID],
    };
    expect(prisma.taxClass.updateMany).toHaveBeenCalledWith({
      where: { id: staleClasses },
      data: { isDefault: false },
    });
    expect(prisma.productType.updateMany).toHaveBeenCalledWith({
      where: { taxClassId: staleClasses },
      data: { taxClassId: DOMESTIC_TAX_CLASS_ID },
    });
  });
});

describe('seedShipping', () => {
  describe.each(fixtures)('with the $label fixture', ({ config }) => {
    it('seeds one domestic zone over areaServed with one default method at the stepper-replaced flat rate', async () => {
      const prisma = makePrisma();
      const result = await seedShipping(prisma as never, config);

      expect(result).toEqual({
        zoneId: DOMESTIC_SHIPPING_ZONE_ID,
        methodId: DOMESTIC_SHIPPING_METHOD_ID,
        price: DEFAULT_FLAT_RATE,
      });
      const zone = upsertFor(prisma.shippingZone.upsert, DOMESTIC_SHIPPING_ZONE_ID);
      expect(zone.create).toMatchObject({ countries: config.identity.areaServed, priority: 0 });
      expect(zone.update).toMatchObject({ countries: config.identity.areaServed });

      expect(upsertedIds(prisma.shippingMethod.upsert)).toEqual([DOMESTIC_SHIPPING_METHOD_ID]);
      const method = upsertFor(prisma.shippingMethod.upsert, DOMESTIC_SHIPPING_METHOD_ID);
      expect(method.create).toMatchObject({
        type: 'FLAT_RATE',
        price: DEFAULT_FLAT_RATE,
        isDefault: true,
        estimatedDaysMin: 2,
        estimatedDaysMax: 5,
      });
      // The rate is the operator's once set: the update payload never carries it.
      expect(method.update).toMatchObject({ isDefault: true });
      expect(method.update).not.toHaveProperty('price');
      expect(method.update).not.toHaveProperty('freeAbove');
    });

    it('demotes any other live default in the zone before claiming it', async () => {
      // The one-default-per-zone partial unique index permits a single default
      // among non-deleted methods, so the demote must land before the upsert.
      const prisma = makePrisma();
      await seedShipping(prisma as never, config);

      const demote = prisma.shippingMethod.updateMany.mock.calls.find(
        (c) => (c[0] as { where: { zoneId?: string } }).where.zoneId === DOMESTIC_SHIPPING_ZONE_ID,
      )?.[0] as { where: Record<string, unknown>; data: Record<string, unknown> };
      expect(demote.data).toEqual({ isDefault: false });
      expect(demote.where).toMatchObject({
        isDefault: true,
        id: { not: DOMESTIC_SHIPPING_METHOD_ID },
      });
      expect(prisma.shippingMethod.updateMany.mock.invocationCallOrder[1]).toBeLessThan(
        prisma.shippingMethod.upsert.mock.invocationCallOrder[0],
      );
    });

    it('carries a real update payload on every upsert', async () => {
      const prisma = makePrisma();
      await seedShipping(prisma as never, config);

      for (const call of [
        ...prisma.shippingZone.upsert.mock.calls,
        ...prisma.shippingMethod.upsert.mock.calls,
      ]) {
        expect(Object.keys((call[0] as Call).update ?? {}).length).toBeGreaterThan(0);
      }
    });
  });

  it('falls back to the store country when areaServed is empty', async () => {
    const prisma = makePrisma();
    const config: StoreRuntimeConfig = {
      ...gulf,
      identity: { ...gulf.identity, areaServed: [] },
    };
    await seedShipping(prisma as never, config);

    const zone = upsertFor(prisma.shippingZone.upsert, DOMESTIC_SHIPPING_ZONE_ID);
    expect(zone.create).toMatchObject({ countries: ['AE'] });
  });

  it('seeds no zone and no method for the neutral config', async () => {
    const prisma = makePrisma();
    const result = await seedShipping(prisma as never, NEUTRAL_STORE_CONFIG);

    expect(result).toBeNull();
    expect(prisma.shippingZone.upsert).not.toHaveBeenCalled();
    expect(prisma.shippingMethod.upsert).not.toHaveBeenCalled();
    // A config that names no country says nothing about the store, so nothing
    // an earlier run or an operator created is retired.
    expect(prisma.shippingZone.updateMany).not.toHaveBeenCalled();
    expect(prisma.shippingMethod.updateMany).not.toHaveBeenCalled();
  });

  it('retires every other seed-planted zone and method, by id prefix', async () => {
    // The generic demo trio and the two client-scoped families each wrote
    // their ids under one of these prefixes, so a sweep that spares the live
    // domestic pair reaches all of them without this module naming a client.
    // Operator rows carry cuids and are never matched.
    const prisma = makePrisma();
    await seedShipping(prisma as never, maghreb);

    expect([...SEED_SHIPPING_ZONE_ID_PREFIXES]).toEqual(['zone-', 'dtn-zone-', 'fx-zone-']);
    expect([...SEED_SHIPPING_METHOD_ID_PREFIXES]).toEqual(['sm-', 'dtn-sm-', 'fx-sm-']);
    expect(prisma.shippingZone.updateMany.mock.calls[0][0]).toEqual({
      where: {
        OR: [
          { id: { startsWith: 'zone-' } },
          { id: { startsWith: 'dtn-zone-' } },
          { id: { startsWith: 'fx-zone-' } },
        ],
        id: { notIn: [DOMESTIC_SHIPPING_ZONE_ID] },
        deletedAt: null,
      },
      data: { isActive: false, deletedAt: expect.any(Date) },
    });
    // Methods go first, by their own id prefix and by their zone's, and a
    // method inside the live zone is never swept whatever its id.
    expect(prisma.shippingMethod.updateMany.mock.calls[0][0]).toEqual({
      where: {
        OR: [
          { id: { startsWith: 'sm-' } },
          { id: { startsWith: 'dtn-sm-' } },
          { id: { startsWith: 'fx-sm-' } },
          { zoneId: { startsWith: 'zone-' } },
          { zoneId: { startsWith: 'dtn-zone-' } },
          { zoneId: { startsWith: 'fx-zone-' } },
        ],
        id: { notIn: [DOMESTIC_SHIPPING_METHOD_ID] },
        zoneId: { notIn: [DOMESTIC_SHIPPING_ZONE_ID] },
        deletedAt: null,
      },
      data: { isActive: false, isDefault: false, deletedAt: expect.any(Date) },
    });
    expect(prisma.shippingMethod.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.shippingZone.updateMany.mock.invocationCallOrder[0],
    );
  });
});

describe('seedPaymentMethods', () => {
  it('creates cash on delivery once, enabled, with no provider config', async () => {
    const prisma = makePrisma();
    const result = await seedPaymentMethods(prisma as never);

    expect(result).toEqual({ code: COD_PAYMENT_METHOD_CODE, created: true });
    expect(prisma.paymentMethod.create).toHaveBeenCalledTimes(1);
    const data = (prisma.paymentMethod.create.mock.calls[0][0] as { data: Record<string, unknown> })
      .data;
    expect(data).toMatchObject({ code: 'cod', provider: 'cod', isActive: true, config: {} });
    expect(data['name']).toMatchObject({
      default: expect.any(String),
      fr: expect.any(String),
      en: expect.any(String),
      ar: expect.any(String),
    });
  });

  it('does not re-create or touch an existing row, so an operator edit survives a deploy', async () => {
    const prisma = makePrisma(true);
    const result = await seedPaymentMethods(prisma as never);

    expect(result).toEqual({ code: COD_PAYMENT_METHOD_CODE, created: false });
    expect(prisma.paymentMethod.create).not.toHaveBeenCalled();
  });
});

describe('seed copy follows the locale registry', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it('payment method copy covers every registry locale', async () => {
    const prisma = makePrisma();
    await seedPaymentMethods(prisma as never);
    const data = (prisma.paymentMethod.create.mock.calls[0][0] as { data: Record<string, unknown> })
      .data;
    for (const field of ['name', 'description']) {
      expect(Object.keys(data[field] as object).sort()).toEqual(
        ['default', ...registryLocaleCodes()].sort(),
      );
    }
  });

  it('canary: a new registry locale fails the payment seed until its copy exists', async () => {
    restore = registerScratchLocale('zz', 'ltr');
    await expect(seedPaymentMethods(makePrisma() as never)).rejects.toThrow(/zz/);
  });

  it('canary: a new registry locale fails the tax seed until its copy exists', async () => {
    restore = registerScratchLocale('zz', 'ltr');
    await expect(seedTax(makePrisma() as never, gulf)).rejects.toThrow(/zz/);
  });

  it('canary: a new registry locale fails the shipping seed until its copy exists', async () => {
    restore = registerScratchLocale('zz', 'ltr');
    const config = runtimeConfigOfFixture(loadStoreConfigFixture('gulf-rtl'));
    await expect(seedShipping(makePrisma() as never, config)).rejects.toThrow(/zz/);
  });
});
