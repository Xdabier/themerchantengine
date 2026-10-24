import type { Prisma, PrismaClient } from '@prisma/client';
import { FIXTURE_CATALOGUE_PREFIXES } from './lib/idempotency';
import { localized } from './lib/translatable';

/**
 * 1 store-issued gift card. No GiftCardTransaction rows written —
 * that ledger is append-only (§3.4).
 */
export async function seedGiftCards(
  prisma: PrismaClient,
  currency: string,
): Promise<{ giftCards: number }> {
  await prisma.giftCard.create({
    data: {
      code: `${FIXTURE_CATALOGUE_PREFIXES.giftCardCode}WELCOME100`,
      initialBalance: 100,
      currentBalance: 100,
      currency,
      personalMessage: localized({
        en: 'A small welcome from Northwind.',
        fr: 'Un petit cadeau de bienvenue de Northwind.',
        ar: 'هدية ترحيب صغيرة من Northwind.',
      }) satisfies Prisma.InputJsonValue,
      isActive: true,
    },
  });
  return { giftCards: 1 };
}
