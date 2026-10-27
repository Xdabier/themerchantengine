import type { Prisma, PrismaClient } from '@prisma/client';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import type { SeededProduct } from './products';
import type { StoreRuntimeConfig } from '../../../libs/shared/common/src/store-config-fixtures/store-config-fixture.schema';
import { seedAddress } from './lib/seed-address';

/**
 * Seeds one DELIVERED order so the COD test customer
 * (`cod-test+fixture@fixture.test`) satisfies the verified-purchase
 * gate at `apps/api/src/modules/reviews/reviews.service.ts:117-127`. The
 * happy-path storefront review-create journey at
 * `apps/storefront-e2e/src/reviews.journey.spec.ts:166` and the answer-
 * question / edit-own-review tests at `:267, :318` all depend on this
 * fixture.
 *
 * Idempotent: find-then-create on `(userId, items.productId, status=DELIVERED)`.
 * Constitution §3.4 forbids updating or deleting Order / OrderItem rows
 * (append-only), so the seed must never `upsert` either model — only
 * `create` when missing. `idempotency.ts` excludes this customer from
 * the user-pool cleanup so the seeded row never becomes orphaned.
 *
 * Order numbers from the production sequence path
 * (`apps/api/src/modules/orders/orders.service.ts:1099-1119`) are
 * reserved for runtime checkout. The seed uses a stable, seed-scoped
 * prefix so re-seed attempts can't clash with sequence-generated values.
 */
const COD_CUSTOMER_EMAIL = 'cod-test+fixture@fixture.test';
const SEED_PRODUCT_SLUG = 'fx-laptop-pro-16-studio';
const SEED_ORDER_NUMBER = 'ORD-2026-KHSEED01';
const SEED_QUANTITY = 1;

export async function seedOrders(args: {
  /** The store's identity, so the order ships to a market the store covers. */
  identity: StoreRuntimeConfig['identity'];
  /** The store's currency, from the runtime config (DR-31). */
  currency: string;
  prisma: PrismaClient;
  products: SeededProduct[];
}): Promise<{ delivered: number }> {
  const customer = await args.prisma.user.findUnique({
    where: { email: COD_CUSTOMER_EMAIL },
    select: { id: true },
  });
  if (!customer) {
    throw new Error(
      `seedOrders: customer ${COD_CUSTOMER_EMAIL} not found — seedCustomer must run first`,
    );
  }

  const product = args.products.find((p) => p.slug === SEED_PRODUCT_SLUG);
  if (!product) {
    throw new Error(`seedOrders: product slug ${SEED_PRODUCT_SLUG} missing from SeededProducts`);
  }

  const productRow = await args.prisma.product.findUnique({
    where: { id: product.id },
    select: { name: true },
  });
  if (!productRow) {
    throw new Error(`seedOrders: product ${SEED_PRODUCT_SLUG} not in DB`);
  }

  const existing = await args.prisma.order.findFirst({
    where: {
      userId: customer.id,
      status: OrderStatus.DELIVERED,
      items: { some: { productId: product.id } },
    },
    select: { id: true },
  });
  if (existing) {
    return { delivered: 0 };
  }

  const unitPrice = product.row.price;
  const subtotal = unitPrice * SEED_QUANTITY;
  // Flat 10 of the store currency in shipping, so the fixture order exercises the
  // visible-shipping-in-total path end to end.
  const shippingAmount = 10;
  const orderTotal = subtotal + shippingAmount;
  const deliveredAt = new Date();
  deliveredAt.setUTCDate(deliveredAt.getUTCDate() - 30);

  const address = seedAddress(args.identity, 'Aisha Rivera') as unknown as Prisma.InputJsonObject;

  await args.prisma.order.create({
    data: {
      orderNumber: SEED_ORDER_NUMBER,
      user: { connect: { id: customer.id } },
      status: OrderStatus.DELIVERED,
      paymentStatus: PaymentStatus.CAPTURED,
      shippingAddress: address,
      billingAddress: address,
      subtotal,
      discountAmount: 0,
      shippingAmount,
      shippingMethodName: 'Standard Delivery',
      taxAmount: 0,
      total: orderTotal,
      currency: args.currency,
      deliveredAt,
      items: {
        create: [
          {
            variantId: product.variantId,
            productId: product.id,
            productName: productRow.name as object,
            sku: product.row.sku,
            unitPrice,
            quantity: SEED_QUANTITY,
            discountAmount: 0,
            taxAmount: 0,
            total: subtotal,
          },
        ],
      },
    },
  });

  return { delivered: 1 };
}
