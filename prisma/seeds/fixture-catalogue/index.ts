import type { PrismaClient } from '@prisma/client';

import type { StoreRuntimeConfig } from '../../../libs/shared/common/src/store-config-fixtures/store-config-fixture.schema';
import { clearFixtureCatalogueScope } from './lib/idempotency';
import { resolveSeedStorageDriver, type SeedStorageDriver } from './lib/storage';
import { seedCategories } from './categories';
import { seedProducts } from './products';
import { seedInventory } from './inventory';
import { seedReviewers } from './reviewers';
import { seedReviews } from './reviews';
import { seedQuestions } from './questions';
import { seedPromotions } from './promotions';
import { seedGiftCards } from './gift-cards';
import { seedCatalogueShipping } from './shipping';
import { seedCustomer } from './customer';
import { seedOrders } from './orders';
import { seedStorefrontSections } from './storefront-sections';
import { seedSeoRedirects } from './seo-redirects';

export interface FixtureCatalogueSeedSummary {
  categories: number;
  products: number;
  variants: number;
  stockLevels: number;
  reviewers: number;
  reviews: number;
  questions: number;
  promotions: number;
  giftCards: number;
  shipping: { methodId: string; price: number } | null;
  customer: { id: string };
  ordersDelivered: number;
  cleared: Record<string, number>;
}

/**
 * Idempotent fixture catalogue seeder. Runs in dependency order:
 * 1. Drop catalogue-scoped rows (never touches append-only tables).
 * 2. Categories → Products → Variants → Stock → Reviewers → Reviews →
 * Questions → Promotions → Gift cards → Customer → Orders.
 *
 * Orders is the only step that writes an append-only table (§3.4). The
 * write is a find-then-create guard, never an upsert / update / delete —
 * see `orders.ts` and the static guard in
 * `__tests__/append-only-static.spec.ts`.
 */
export async function seedFixtureCatalogue(args: {
  /** The store's locale set, for the per-locale SEO redirect rows. */
  localization: StoreRuntimeConfig['localization'];
  /** The store's identity, so every seeded address is in a market it ships to. */
  identity: StoreRuntimeConfig['identity'];
  /**
   * The store's currency, from the runtime config (DR-31). The catalogue rows
   * that carry one, the gift card and the seeded order, are priced in it rather
   * than in a literal, which used to be one client's code.
   */
  currency: string;
  prisma: PrismaClient;
  storage?: SeedStorageDriver;
  log?: (msg: string) => void;
}): Promise<FixtureCatalogueSeedSummary> {
  const log = args.log ?? ((m: string) => console.log(`  [fixture-catalogue] ${m}`));
  const storage = args.storage ?? resolveSeedStorageDriver();

  log('clearing scoped rows…');
  const cleared = await clearFixtureCatalogueScope(args.prisma);
  log(`cleared: ${JSON.stringify(cleared)}`);

  log('categories…');
  const categories = await seedCategories({ prisma: args.prisma, storage });

  log('products + variants + assets…');
  const products = await seedProducts({ prisma: args.prisma, storage, categories });

  log('inventory…');
  const inv = await seedInventory({ prisma: args.prisma, products, identity: args.identity });

  log('reviewers…');
  const reviewers = await seedReviewers(args.prisma);

  log('reviews…');
  const reviews = await seedReviews({ prisma: args.prisma, products, reviewers });

  log('questions…');
  const questions = await seedQuestions({ prisma: args.prisma, products, reviewers });

  log('promotions…');
  const promotions = await seedPromotions({ prisma: args.prisma, categories });

  log('gift cards…');
  const giftCards = await seedGiftCards(args.prisma, args.currency);

  log('shipping…');
  const shipping = await seedCatalogueShipping({ prisma: args.prisma });
  log(
    shipping
      ? `shipping: method=${shipping.methodId} price=${shipping.price}`
      : 'shipping: no domestic zone configured, skipped',
  );

  log('customer…');
  const customer = await seedCustomer({ prisma: args.prisma, products, identity: args.identity });

  log('orders…');
  const orders = await seedOrders({
    prisma: args.prisma,
    products,
    currency: args.currency,
    identity: args.identity,
  });
  log(`orders: delivered=${orders.delivered}`);

  log('seo redirects…');
  const seoRedirects = await seedSeoRedirects(args.prisma, {
    localization: args.localization,
  } as StoreRuntimeConfig);
  log(`seo redirects: ${seoRedirects.redirects}`);

  log('storefront sections…');
  await seedStorefrontSections({ prisma: args.prisma, storage, log });

  log('done.');

  return {
    categories: categories.length,
    products: products.length,
    variants: products.length,
    stockLevels: inv.stockLevels,
    reviewers: reviewers.length,
    reviews: reviews.reviews,
    questions: questions.questions,
    promotions: promotions.promotions,
    giftCards: giftCards.giftCards,
    shipping: shipping && { methodId: shipping.methodId, price: shipping.price },
    customer: { id: customer.customerId },
    ordersDelivered: orders.delivered,
    cleared,
  };
}
