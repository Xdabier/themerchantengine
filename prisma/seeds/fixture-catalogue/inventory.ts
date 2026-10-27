import type { PrismaClient } from '@prisma/client';
import { FIXTURE_CATALOGUE_PREFIXES } from './lib/idempotency';
import type { SeededProduct } from './products';
import type { StoreRuntimeConfig } from '../../../libs/shared/common/src/store-config-fixtures/store-config-fixture.schema';
import { seedWarehouseAddress } from './lib/seed-address';

/**
 * Seed `StockLevel` rows directly. Constitution §3.4 forbids writing to
 * `InventoryMovement` (append-only) — the seed shapes initial inventory state
 * by writing the materialised `StockLevel` cache only.
 *
 * Stock distribution (per S2.6):
 * - most variants healthy (50-200 onHand)
 * - 3 variants low-stock (onHand=2 or 3)
 * - 1 variant out-of-stock (onHand=0)
 * The product seed tags each row's `stockBand` so the distribution is
 * deterministic across re-runs.
 */
export async function seedInventory(args: {
  /** The store's identity, so the warehouse sits in its own market. */
  identity: StoreRuntimeConfig['identity'];
  prisma: PrismaClient;
  products: SeededProduct[];
}): Promise<{ locationId: string; stockLevels: number }> {
  const location = await args.prisma.inventoryLocation.upsert({
    where: { code: FIXTURE_CATALOGUE_PREFIXES.inventoryLocationCode },
    update: {},
    create: {
      name: 'Northwind Main Warehouse',
      code: FIXTURE_CATALOGUE_PREFIXES.inventoryLocationCode,
      address: seedWarehouseAddress(args.identity),
      isActive: true,
    },
  });

  let count = 0;
  for (const p of args.products) {
    const onHand = onHandForBand(p.row.stockBand);
    await args.prisma.stockLevel.upsert({
      where: { variantId_locationId: { variantId: p.variantId, locationId: location.id } },
      update: { onHand, reserved: 0 },
      create: { variantId: p.variantId, locationId: location.id, onHand, reserved: 0 },
    });
    count += 1;
  }

  return { locationId: location.id, stockLevels: count };
}

function onHandForBand(band: 'in' | 'low' | 'oos'): number {
  if (band === 'oos') return 0;
  if (band === 'low') return 2;
  // Pseudo-random spread within healthy band. Capped at 149 (not 199): the
  // buy-box over-ask e2e sets the quantity stepper to its own 99-unit cap and
  // clicks add twice, so the server must refuse a 198-unit ask on WHICHEVER
  // healthy product the test finds first. A ceiling above 198 made that
  // refusal a coin flip on every seed instead of a guarantee.
  return 50 + Math.floor(Math.random() * 100);
}
