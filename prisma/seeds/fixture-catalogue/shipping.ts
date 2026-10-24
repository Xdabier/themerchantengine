import type { PrismaClient } from '@prisma/client';
import { localized } from './lib/translatable';
import { DOMESTIC_SHIPPING_ZONE_ID } from '../store-config/shipping';

/**
 * A second delivery method on the store's own domestic zone, so the checkout
 * journeys have a choice to make (plan E2.6).
 *
 * It used to be a zone of its own, pinned to one country and one currency, and
 * the config-driven shipping seed retires every `fx-zone-*` row on the way past,
 * so the storefront test wrapper had to re-add a method after every reseed. The
 * method lives on `DOMESTIC_SHIPPING_ZONE_ID` now, which the config seed builds
 * from `identity.address.country`, so the seed and the runtime config agree by
 * construction and the after-the-fact patch is gone.
 *
 * Priced in whatever the store's currency is: the amount is a number and the
 * money column is `Decimal(12, 3)` for every currency, so the same figure is
 * seven of the configured unit whichever unit that is.
 *
 * Idempotent: upsert by a stable id with a full `update` payload, so re-running
 * reconciles a price or name change.
 */
export const FIXTURE_CATALOGUE_SHIPPING_METHOD_ID = 'fx-sm-express';
export const FIXTURE_CATALOGUE_SHIPPING_METHOD_NAME = 'Express Delivery';
const EXPRESS_RATE = 7;

export async function seedCatalogueShipping(args: {
  prisma: PrismaClient;
}): Promise<{ zoneId: string; methodId: string; price: number } | null> {
  const { prisma } = args;

  // The config seed skips the zone entirely when the store serves no country,
  // and a method with no zone is not a method. A store that has configured
  // nowhere to ship simply gets the one default the config seed plants.
  const zone = await prisma.shippingZone.findFirst({
    where: { id: DOMESTIC_SHIPPING_ZONE_ID, deletedAt: null },
    select: { id: true },
  });
  if (!zone) return null;

  const name = localized({
    en: FIXTURE_CATALOGUE_SHIPPING_METHOD_NAME,
    fr: 'Livraison express',
    ar: 'توصيل سريع',
  });
  const payload = {
    zoneId: DOMESTIC_SHIPPING_ZONE_ID,
    name,
    type: 'FLAT_RATE' as const,
    price: EXPRESS_RATE,
    estimatedDaysMin: 1,
    estimatedDaysMax: 2,
    isActive: true,
    // Never the default: the config seed owns that flag, and the
    // one-default-per-zone partial-unique index permits a single one.
    isDefault: false,
    sortOrder: 1,
  };
  await prisma.shippingMethod.upsert({
    where: { id: FIXTURE_CATALOGUE_SHIPPING_METHOD_ID },
    update: { ...payload, deletedAt: null },
    create: { id: FIXTURE_CATALOGUE_SHIPPING_METHOD_ID, ...payload },
  });

  return {
    zoneId: DOMESTIC_SHIPPING_ZONE_ID,
    methodId: FIXTURE_CATALOGUE_SHIPPING_METHOD_ID,
    price: EXPRESS_RATE,
  };
}
