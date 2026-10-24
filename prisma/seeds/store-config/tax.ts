import type { PrismaClient } from '@prisma/client';
import { localized } from '../lib/localized';
import type { StoreRuntimeConfig } from '../../../libs/shared/common/src/store-config-fixtures/store-config-fixture.schema';

/**
 * Seeds the store's tax baseline from the runtime config (DR-31, plan E1.4):
 * one domestic zone at `money.vatRate` for `identity.address.country`, its
 * Standard tax class, and a zero-rated catch-all for everywhere else.
 *
 * Lives in its own module because BOTH seed paths need it. The prod-safe
 * `SEED_SCOPE=notifications-rbac` branch is the only seed CI runs on a deploy,
 * and it once planted shipping with no tax zone at all, so production shipped
 * untaxed while the demo path had a catch-all at the wrong rate.
 *
 * Every upsert carries a REAL `update` payload. An `update: {}` upsert never
 * reconciles a changed rate: it matches by the hardcoded id, applies nothing,
 * and reports success while the old rate stays live.
 *
 * A fresh engine (the neutral config) has no country and a zero VAT rate, so
 * it seeds only the catch-all and retires nothing; the CLI stepper fills the
 * rest in.
 */

export const DOMESTIC_TAX_ZONE_ID = 'taxzone-domestic';
export const DOMESTIC_TAX_CLASS_ID = 'taxclass-standard-domestic';
export const CATCH_ALL_TAX_ZONE_ID = 'taxzone-default';
export const CATCH_ALL_TAX_CLASS_ID = 'taxclass-standard-default';

/**
 * Every generation of this seed wrote its zone and class ids by hand under
 * these prefixes; rows an operator creates carry cuid ids and never match.
 * The earlier generations' ids name a client, so the retire step below finds
 * them by prefix rather than spelling them here.
 */
export const SEED_TAX_ZONE_ID_PREFIX = 'taxzone-';
export const SEED_TAX_CLASS_ID_PREFIX = 'taxclass-';

const domesticZoneName = () =>
  localized({ en: 'Domestic VAT', fr: 'TVA nationale', ar: 'ضريبة القيمة المضافة المحلية' });

const catchAllZoneName = () => localized({ en: 'Elsewhere', fr: 'Ailleurs', ar: 'خارج البلد' });

/** True when the config describes a country with a standard rate to charge. */
export function hasDomesticTaxZone(config: StoreRuntimeConfig): boolean {
  return config.identity.address.country !== '' && config.money.vatRate > 0;
}

export async function seedTax(
  prisma: PrismaClient,
  config: StoreRuntimeConfig,
): Promise<{ standardClassId: string }> {
  // The catch-all every unmatched country falls through to. Rated ZERO on
  // purpose: a non-zero default would invent a tax liability for a destination
  // no zone models.
  //
  // It holds `isDefault` and the domestic zone does not. `TaxService.resolveZone`
  // matches on `countries: { has: country }` first and falls back to the zone
  // holding `isDefault`. A zone with an empty `countries` array can never
  // satisfy the first rung, so this one is reachable only as the default; and
  // the domestic zone, which lists its country, must not also hold the flag or
  // it swallows every destination it does not list and quotes the domestic
  // rate on it.
  const catchAllName = catchAllZoneName();
  const catchAll = await prisma.taxZone.upsert({
    where: { id: CATCH_ALL_TAX_ZONE_ID },
    update: {
      name: catchAllName,
      countries: [],
      rate: 0,
      isDefault: true,
      isActive: true,
      deletedAt: null,
    },
    create: {
      id: CATCH_ALL_TAX_ZONE_ID,
      name: catchAllName,
      countries: [],
      rate: 0,
      isDefault: true,
      isActive: true,
    },
  });

  const catchAllClass = await prisma.taxClass.upsert({
    where: { id: CATCH_ALL_TAX_CLASS_ID },
    update: { zoneId: catchAll.id, name: 'Standard', rate: 0, isDefault: true },
    create: {
      id: CATCH_ALL_TAX_CLASS_ID,
      zoneId: catchAll.id,
      name: 'Standard',
      rate: 0,
      isDefault: true,
    },
  });

  let standardClassId = catchAllClass.id;
  const liveZoneIds = [CATCH_ALL_TAX_ZONE_ID];
  const liveClassIds = [CATCH_ALL_TAX_CLASS_ID];

  if (hasDomesticTaxZone(config)) {
    liveZoneIds.push(DOMESTIC_TAX_ZONE_ID);
    liveClassIds.push(DOMESTIC_TAX_CLASS_ID);
    const country = config.identity.address.country;
    const rate = config.money.vatRate;
    const name = domesticZoneName();

    const domestic = await prisma.taxZone.upsert({
      where: { id: DOMESTIC_TAX_ZONE_ID },
      update: {
        name,
        countries: [country],
        rate,
        isDefault: false,
        isActive: true,
        deletedAt: null,
      },
      create: {
        id: DOMESTIC_TAX_ZONE_ID,
        name,
        countries: [country],
        rate,
        isDefault: false,
        isActive: true,
      },
    });

    const standard = await prisma.taxClass.upsert({
      where: { id: DOMESTIC_TAX_CLASS_ID },
      update: { zoneId: domestic.id, name: 'Standard', rate, isDefault: true },
      create: {
        id: DOMESTIC_TAX_CLASS_ID,
        zoneId: domestic.id,
        name: 'Standard',
        rate,
        isDefault: true,
      },
    });
    standardClassId = standard.id;
  }

  // A config that names no country says nothing about the store; it must not
  // retire what an earlier run or an operator created (security review C1).
  if (!hasDomesticTaxZone(config)) return { standardClassId };

  // Retire every seed-planted zone that is not live for this config rather
  // than leaving it quoting a rate: the earlier generations' zones. `TaxClass`
  // has `onDelete: Restrict` on `zoneId`, so a hard delete would need its
  // classes repointed or removed first; soft-deleting the zone avoids that
  // ordering problem and keeps the historical rows readable.
  await prisma.taxZone.updateMany({
    where: { id: { startsWith: SEED_TAX_ZONE_ID_PREFIX, notIn: liveZoneIds }, deletedAt: null },
    data: { isActive: false, isDefault: false, deletedAt: new Date() },
  });
  // Their classes cannot be soft-deleted, so they lose the default flag and
  // every product type still pointing at one moves to the live standard class.
  const staleClassIds = { startsWith: SEED_TAX_CLASS_ID_PREFIX, notIn: liveClassIds };
  await prisma.taxClass.updateMany({
    where: { id: staleClassIds },
    data: { isDefault: false },
  });
  await prisma.productType.updateMany({
    where: { taxClassId: staleClassIds },
    data: { taxClassId: standardClassId },
  });

  return { standardClassId };
}
