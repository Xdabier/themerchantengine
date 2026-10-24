import type { PrismaClient } from '@prisma/client';
import { localized } from '../lib/localized';
import type { StoreRuntimeConfig } from '../../../libs/shared/common/src/store-config-fixtures/store-config-fixture.schema';

/**
 * Seeds the store's shipping baseline from the runtime config (DR-31, plan
 * E1.4): one domestic zone over `identity.areaServed` (or the store's own
 * country when that list is empty) with a single flat-rate default method.
 * That default is the method the storefront checkout auto-applies and the
 * admin shows with a "Default" badge.
 *
 * A fresh engine (the neutral config) serves no country yet, so it seeds no
 * zone, retires nothing, and returns null; the CLI stepper creates the first
 * one. Re-running reconciles names and windows; the rate and the free-shipping
 * threshold are written once and then belong to the operator.
 */
export const DOMESTIC_SHIPPING_ZONE_ID = 'zone-domestic';
export const DOMESTIC_SHIPPING_METHOD_ID = 'sm-domestic-standard';

/**
 * Starting flat rate in the store currency, whatever that currency is. The
 * CLI stepper (plan E4) asks the operator for the real rate and replaces it;
 * until then a seeded store quotes this on every domestic order.
 */
export const DEFAULT_FLAT_RATE = 10;

/**
 * Every generation of this seed wrote its zone and method ids by hand under
 * one of these prefixes (the generic demo trio, then two client-scoped
 * families); rows an operator creates carry cuid ids and never match. The
 * earlier generations' ids name a client, so the retire step below finds them
 * by prefix rather than spelling them here.
 */
export const SEED_SHIPPING_ZONE_ID_PREFIXES = ['zone-', 'dtn-zone-', 'fx-zone-'] as const;
export const SEED_SHIPPING_METHOD_ID_PREFIXES = ['sm-', 'dtn-sm-', 'fx-sm-'] as const;

const zoneName = () => localized({ en: 'Domestic', fr: 'National', ar: 'محلي' });
const methodName = () =>
  localized({ en: 'Standard delivery', fr: 'Livraison standard', ar: 'التوصيل العادي' });

/** The countries the domestic zone covers; empty when the config names none. */
export function shippingCountries(config: StoreRuntimeConfig): string[] {
  if (config.identity.areaServed.length > 0) return [...config.identity.areaServed];
  const country = config.identity.address.country;
  return country ? [country] : [];
}

/**
 * The rate a first seed plants: the stepper's answer when it ran
 * (`SEED_SHIPPING_FLAT_RATE`), the placeholder otherwise. Read only on create,
 * so an operator's later edit is never overwritten by a reseed.
 */
export function seedFlatRate(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['SEED_SHIPPING_FLAT_RATE'];
  if (raw === undefined || raw === '') return DEFAULT_FLAT_RATE;
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error(
      `SEED_SHIPPING_FLAT_RATE=${raw} is not a rate; expected a number of zero or more`,
    );
  }
  return rate;
}

export async function seedShipping(
  prisma: PrismaClient,
  config: StoreRuntimeConfig,
  options: { flatRate?: number } = {},
): Promise<{ zoneId: string; methodId: string; price: number } | null> {
  const countries = shippingCountries(config);
  const flatRate = options.flatRate ?? DEFAULT_FLAT_RATE;

  // A config that names no country says nothing about the store; it must not
  // retire what an earlier run or an operator created (security review C1).
  if (countries.length === 0) return null;

  // Retire every seed-planted zone and method that is not live for this
  // config: the earlier generations' rows.
  //
  // Methods first: a zone whose methods are still live and default can leave
  // the one-default-per-zone partial unique index holding a row in a zone that
  // no longer exists to the reader. A method is stale when its own id or its
  // zone's id carries a seed prefix, unless it sits in the live zone.
  const liveZoneIds = [DOMESTIC_SHIPPING_ZONE_ID];
  const liveMethodIds = [DOMESTIC_SHIPPING_METHOD_ID];
  await prisma.shippingMethod.updateMany({
    where: {
      OR: [
        ...SEED_SHIPPING_METHOD_ID_PREFIXES.map((prefix) => ({ id: { startsWith: prefix } })),
        ...SEED_SHIPPING_ZONE_ID_PREFIXES.map((prefix) => ({ zoneId: { startsWith: prefix } })),
      ],
      id: { notIn: liveMethodIds },
      zoneId: { notIn: liveZoneIds },
      deletedAt: null,
    },
    data: { isActive: false, isDefault: false, deletedAt: new Date() },
  });
  await prisma.shippingZone.updateMany({
    where: {
      OR: SEED_SHIPPING_ZONE_ID_PREFIXES.map((prefix) => ({ id: { startsWith: prefix } })),
      id: { notIn: liveZoneIds },
      deletedAt: null,
    },
    data: { isActive: false, deletedAt: new Date() },
  });

  await prisma.shippingZone.upsert({
    where: { id: DOMESTIC_SHIPPING_ZONE_ID },
    update: {
      name: zoneName(),
      countries,
      priority: 0,
      isActive: true,
      deletedAt: null,
    },
    create: {
      id: DOMESTIC_SHIPPING_ZONE_ID,
      name: zoneName(),
      countries,
      priority: 0,
      isActive: true,
    },
  });

  // Demote any other live default in this zone first: the one-default-per-zone
  // partial-unique index permits a single default among non-deleted methods.
  await prisma.shippingMethod.updateMany({
    where: {
      zoneId: DOMESTIC_SHIPPING_ZONE_ID,
      isDefault: true,
      deletedAt: null,
      id: { not: DOMESTIC_SHIPPING_METHOD_ID },
    },
    data: { isDefault: false },
  });

  await prisma.shippingMethod.upsert({
    where: { id: DOMESTIC_SHIPPING_METHOD_ID },
    // The rate and the free-shipping threshold are the operator's once set:
    // an update that reset them would undo an admin edit on every deploy.
    update: {
      zoneId: DOMESTIC_SHIPPING_ZONE_ID,
      name: methodName(),
      type: 'FLAT_RATE',
      estimatedDaysMin: 2,
      estimatedDaysMax: 5,
      isActive: true,
      isDefault: true,
      sortOrder: 0,
      deletedAt: null,
    },
    create: {
      id: DOMESTIC_SHIPPING_METHOD_ID,
      zoneId: DOMESTIC_SHIPPING_ZONE_ID,
      name: methodName(),
      type: 'FLAT_RATE',
      price: flatRate,
      estimatedDaysMin: 2,
      estimatedDaysMax: 5,
      isActive: true,
      isDefault: true,
      sortOrder: 0,
    },
  });

  return {
    zoneId: DOMESTIC_SHIPPING_ZONE_ID,
    methodId: DOMESTIC_SHIPPING_METHOD_ID,
    price: flatRate,
  };
}
