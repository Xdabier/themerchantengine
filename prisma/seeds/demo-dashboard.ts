/**
 * Demo-dashboard seed — fills the admin dashboard, orders list, and analytics
 * screens with realistic recent data for screenshots and demos.
 *
 * Creates (all tagged so re-runs are idempotent):
 * - ~30 orders over the last 30 days (orderNumber ORD-2026-90xx)
 * - analytics events with funnel steps + unique sessions (sessionId demo-*)
 * - recent audit-log activity (ipAddress 10.0.0.99 marker)
 *
 * Dev-only. Run from repo root:
 *   npx ts-node prisma/seeds/demo-dashboard.ts
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { storeConfigFromSettingRows } from '../../libs/shared/common/src/store-config';

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

const DEMO_ORDER_PREFIX = 'ORD-2026-90';
const DEMO_SESSION_PREFIX = 'demo-';
const DEMO_AUDIT_IP = '10.0.0.99';

// Deterministic pseudo-random so re-runs produce the same shape.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260814);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function daysAgo(days: number, hour: number, minute: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, Math.floor(rand() * 60), 0);
  return d;
}

async function main(): Promise<void> {
  console.log('Demo-dashboard seed starting...');

  // The demo orders are priced in the store's own currency (DR-31): a literal
  // here put one client's code on every row of a dashboard screenshot.
  const storeConfig = storeConfigFromSettingRows(
    await prisma.storeSetting.findMany({ select: { group: true, key: true, value: true } }),
  );
  const currency = storeConfig.money.currencyCode;

  // ── Cleanup previous demo data ────────────────────────────────────────────
  const oldOrders = await prisma.order.findMany({
    where: { orderNumber: { startsWith: DEMO_ORDER_PREFIX } },
    select: { id: true },
  });
  const oldOrderIds = oldOrders.map((o) => o.id);
  if (oldOrderIds.length > 0) {
    await prisma.orderItem.deleteMany({ where: { orderId: { in: oldOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: oldOrderIds } } });
  }
  await prisma.analyticsEvent.deleteMany({
    where: { sessionId: { startsWith: DEMO_SESSION_PREFIX } },
  });
  await prisma.auditLogEntry.deleteMany({ where: { ipAddress: DEMO_AUDIT_IP } });
  console.log(`  Cleanup: ${oldOrderIds.length} demo orders + events + audit entries removed`);

  // ── Source data: real products with images + existing users ───────────────
  const products = await prisma.product.findMany({
    where: { slug: { startsWith: 'fx-' }, status: 'ACTIVE', deletedAt: null },
    include: { variants: { where: { isDefault: true }, take: 1 } },
    take: 12,
    orderBy: { createdAt: 'asc' },
  });
  const sellable = products.filter((p) => p.variants.length > 0);
  if (sellable.length === 0) {
    throw new Error('No fx-* products with default variants found. Run the main seed first.');
  }

  const customers = await prisma.user.findMany({
    where: { role: 'CUSTOMER', deletedAt: null },
    take: 8,
    orderBy: { createdAt: 'asc' },
  });
  const admin = await prisma.user.findFirst({ where: { email: 'admin@merchants.test' } });

  // ── Orders: ~30 spread across the last 30 days, weighted to recent days ───
  const statuses = [
    { status: 'DELIVERED', paymentStatus: 'CAPTURED' },
    { status: 'DELIVERED', paymentStatus: 'CAPTURED' },
    { status: 'SHIPPED', paymentStatus: 'CAPTURED' },
    { status: 'CONFIRMED', paymentStatus: 'CAPTURED' },
    { status: 'PENDING', paymentStatus: 'PENDING' },
  ] as const;

  // The store's own market, so a demo order can be shipped by the store that
  // seeded it. The address used to be one retired client's city (plan E2.6).
  const shippingSnap = {
    fullName: 'Demo Customer',
    phone: storeConfig.identity.contact.phone,
    addressLine1: storeConfig.identity.address.street.default,
    city: storeConfig.identity.address.locality,
    country: storeConfig.identity.address.country,
    postalCode: storeConfig.identity.address.postalCode ?? '',
  };

  // Day offsets: guarantee orders today, this week, and across the month.
  const dayOffsets: number[] = [
    0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26,
    28, 29,
  ];

  const orderDates: { id: string; createdAt: Date; total: number }[] = [];
  let seq = 1;
  for (const offset of dayOffsets) {
    const product = pick(sellable);
    const variant = product.variants[0];
    const qty = rand() < 0.75 ? 1 : 2;
    const unitPrice = Number(variant.price);
    const shippingAmount = unitPrice * qty >= 300 ? 0 : 10;
    const subtotal = unitPrice * qty;
    const total = subtotal + shippingAmount;
    const state = offset === 0 && seq <= 2 ? statuses[3] : pick([...statuses]);
    const createdAt = daysAgo(offset, 8 + Math.floor(rand() * 12), Math.floor(rand() * 60));
    const orderNumber = `${DEMO_ORDER_PREFIX}${String(seq).padStart(2, '0')}`;

    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId: customers.length > 0 ? pick(customers).id : null,
        status: state.status,
        paymentStatus: state.paymentStatus,
        shippingAddress: shippingSnap,
        billingAddress: shippingSnap,
        subtotal,
        shippingAmount,
        taxAmount: 0,
        discountAmount: 0,
        total,
        shippingMethodName:
          shippingAmount === 0 ? `Free Shipping (300+ ${currency})` : 'Standard Delivery',
        currency,
        createdAt,
        deliveredAt: state.status === 'DELIVERED' ? daysAgo(Math.max(0, offset - 2), 14, 30) : null,
        items: {
          create: [
            {
              variantId: variant.id,
              productId: product.id,
              productName: product.name as object,
              variantLabel: null,
              sku: variant.sku,
              unitPrice,
              quantity: qty,
              total: subtotal,
            },
          ],
        },
      },
    });
    orderDates.push({ id: order.id, createdAt, total });
    seq += 1;
  }
  console.log(`  Orders: ${orderDates.length} demo orders created`);

  // ── Analytics events: sessions + funnel over the last 30 days ─────────────
  type EventRow = {
    eventType: string;
    sessionId: string;
    productId: string | null;
    orderId: string | null;
    locale: string;
    createdAt: Date;
    data: object;
  };
  const events: EventRow[] = [];
  let sessionCounter = 0;

  for (let offset = 29; offset >= 0; offset -= 1) {
    // Growing traffic: older days quieter, recent days busier.
    const base = 14 + Math.floor(((29 - offset) / 29) * 26); // 14 → 40 sessions/day
    const sessions = base + Math.floor(rand() * 8);
    for (let s = 0; s < sessions; s += 1) {
      sessionCounter += 1;
      const sessionId = `${DEMO_SESSION_PREFIX}${sessionCounter}`;
      const locale = rand() < 0.6 ? 'fr' : 'en';
      const at = daysAgo(offset, 7 + Math.floor(rand() * 16), Math.floor(rand() * 60));
      const product = pick(sellable);

      events.push({
        eventType: 'product_view',
        sessionId,
        productId: product.id,
        orderId: null,
        locale,
        createdAt: at,
        data: { demo: true },
      });
      if (rand() < 0.25) {
        events.push({
          eventType: 'search',
          sessionId,
          productId: null,
          orderId: null,
          locale,
          createdAt: new Date(at.getTime() + 30_000),
          data: {
            demo: true,
            query: pick(['honey', 'headphones', 'laptop', 'sidr', 'smartwatch']),
          },
        });
      }
      // Funnel: ~38% add to cart, ~55% of those begin checkout, and so on.
      if (rand() < 0.38) {
        events.push({
          eventType: 'add_to_cart',
          sessionId,
          productId: product.id,
          orderId: null,
          locale,
          createdAt: new Date(at.getTime() + 60_000),
          data: { demo: true },
        });
        if (rand() < 0.55) {
          events.push({
            eventType: 'begin_checkout',
            sessionId,
            productId: null,
            orderId: null,
            locale,
            createdAt: new Date(at.getTime() + 120_000),
            data: { demo: true },
          });
          if (rand() < 0.7) {
            events.push({
              eventType: 'add_shipping_info',
              sessionId,
              productId: null,
              orderId: null,
              locale,
              createdAt: new Date(at.getTime() + 180_000),
              data: { demo: true },
            });
            events.push({
              eventType: 'add_payment_info',
              sessionId,
              productId: null,
              orderId: null,
              locale,
              createdAt: new Date(at.getTime() + 220_000),
              data: { demo: true },
            });
          }
        }
      }
    }
  }

  // One purchase event per demo order, tied to a fresh session that day.
  for (const order of orderDates) {
    sessionCounter += 1;
    const sessionId = `${DEMO_SESSION_PREFIX}${sessionCounter}`;
    events.push({
      eventType: 'purchase',
      sessionId,
      productId: null,
      orderId: order.id,
      locale: rand() < 0.6 ? 'fr' : 'en',
      createdAt: order.createdAt,
      data: { demo: true, value: order.total },
    });
  }

  await prisma.analyticsEvent.createMany({ data: events });
  console.log(`  Analytics: ${events.length} events across ${sessionCounter} sessions`);

  // ── Audit log: fresh activity for the dashboard feed ──────────────────────
  const auditRows = [
    { action: 'order.status_changed', entityType: 'order', hoursAgo: 1 },
    { action: 'product.update', entityType: 'product', hoursAgo: 2 },
    { action: 'promotion.create', entityType: 'promotion', hoursAgo: 4 },
    { action: 'order.status_changed', entityType: 'order', hoursAgo: 6 },
    { action: 'inventory.adjust', entityType: 'inventory', hoursAgo: 9 },
    { action: 'gift_card.create', entityType: 'gift_card', hoursAgo: 12 },
    { action: 'product.create', entityType: 'product', hoursAgo: 20 },
    { action: 'review.approve', entityType: 'review', hoursAgo: 26 },
  ];
  for (const row of auditRows) {
    const at = new Date(Date.now() - row.hoursAgo * 3_600_000);
    await prisma.auditLogEntry.create({
      data: {
        userId: admin?.id ?? null,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityType === 'order' ? pick(orderDates).id : null,
        ipAddress: DEMO_AUDIT_IP,
        createdAt: at,
      },
    });
  }
  console.log(`  Audit log: ${auditRows.length} activity entries`);

  console.log('Demo-dashboard seed done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
