import type { Prisma, PrismaClient } from '@prisma/client';
import { PromotionApplicationMethod, PromotionType } from '@prisma/client';
import { FIXTURE_CATALOGUE_PREFIXES } from './lib/idempotency';
import { localized } from './lib/translatable';
import type { SeededCategory } from './categories';

/**
 * 3 promotions:
 * - FIXTURE10 — sitewide 10% coupon
 * - WELCOME50 — minimum-spend 50 coupon, 10% off
 * - Auto Electronics 10% — applied via PromotionCategory join
 *
 * No `PromotionUsage` rows written — that table is append-only (§3.4).
 */
export async function seedPromotions(args: {
  prisma: PrismaClient;
  categories: SeededCategory[];
}): Promise<{ promotions: number }> {
  await args.prisma.promotion.create({
    data: {
      name: localized({
        en: 'Northwind Welcome 10%',
        fr: 'Northwind, bienvenue 10%',
        ar: 'Northwind، ترحيب بخصم 10%',
      }) satisfies Prisma.InputJsonValue,
      description: localized({
        en: 'Save 10% on your first Northwind order. Apply at checkout.',
        fr: 'Économisez 10% sur votre première commande Northwind. Code à saisir au paiement.',
        ar: 'وفّر 10% على أول طلب من Northwind. أدخل الرمز عند الدفع.',
      }) satisfies Prisma.InputJsonValue,
      type: PromotionType.PERCENTAGE,
      applicationMethod: PromotionApplicationMethod.COUPON,
      couponCode: FIXTURE_CATALOGUE_PREFIXES.couponCodes[0], // FIXTURE10
      value: 10,
      isActive: true,
      isExclusive: false,
      priority: 10,
    },
  });

  await args.prisma.promotion.create({
    data: {
      name: localized({
        en: 'Welcome over 50',
        fr: 'Bienvenue au-dessus de 50',
        ar: 'ترحيب عند تجاوز 50',
      }) satisfies Prisma.InputJsonValue,
      description: localized({
        en: 'Save 10% when you spend 50 or more on your first order.',
        fr: 'Économisez 10% dès 50 sur votre première commande.',
        ar: 'وفّر 10% عند إنفاق 50 أو أكثر في أول طلب.',
      }) satisfies Prisma.InputJsonValue,
      type: PromotionType.PERCENTAGE,
      applicationMethod: PromotionApplicationMethod.COUPON,
      couponCode: FIXTURE_CATALOGUE_PREFIXES.couponCodes[1], // WELCOME50
      value: 10,
      minimumOrderAmount: 50,
      isActive: true,
      isExclusive: false,
      priority: 11,
    },
  });

  const electronics = args.categories.find((c) => c.slug === 'fx-electronics');
  if (!electronics) {
    throw new Error('Electronics category missing — auto-promo cannot attach');
  }
  const auto = await args.prisma.promotion.create({
    data: {
      name: localized({
        en: 'Electronics Sale 10%',
        fr: 'Électronique, 10% de remise',
        ar: 'تخفيضات الإلكترونيات 10%',
      }) satisfies Prisma.InputJsonValue,
      description: localized({
        en: '10% off all Electronics, applied automatically at checkout.',
        fr: '10% de remise sur toute la catégorie Électronique, appliqué automatiquement au paiement.',
        ar: 'خصم 10% على كل الإلكترونيات، يُطبق تلقائياً عند الدفع.',
      }) satisfies Prisma.InputJsonValue,
      type: PromotionType.PERCENTAGE,
      applicationMethod: PromotionApplicationMethod.AUTOMATIC,
      value: 10,
      isActive: true,
      isExclusive: false,
      priority: 20,
    },
  });
  await args.prisma.promotionCategory.create({
    data: { promotionId: auto.id, categoryId: electronics.id },
  });

  return { promotions: 3 };
}
