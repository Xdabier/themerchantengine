/**
 * RBAC E2E
 *
 * Scenario A — Staff with limited permissions:
 *   Admin creates role with orders:view only →
 *   Admin creates staff with that role →
 *   Staff logs in →
 *   Staff GET /admin/orders → 200 ✓ (has orders:view)
 *   Staff DELETE /admin/products/:id → 403 ✗ (missing products:delete)
 *
 * Scenario B — Customer ownership:
 *   Customer A places order →
 *   Customer B tries GET /orders/:id → 403
 */
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import {
  ADMIN,
  STORE_ADDRESS,
  api,
  createTestPrisma,
  loginAs,
  shippingMethodForCountry,
  signUpCustomer,
} from './helpers';

const STAFF_EMAIL = `rbac-staff-${crypto.randomUUID()}@e2e.test`;
const STAFF_PASSWORD = 'StaffPass1!';
const CUSTOMER_A_EMAIL = `rbac-custA-${crypto.randomUUID()}@e2e.test`;
const CUSTOMER_B_EMAIL = `rbac-custB-${crypto.randomUUID()}@e2e.test`;
const SHARED_PASSWORD = 'Customer1!';

describe('RBAC (e2e)', () => {
  let prisma: PrismaClient;

  let adminCookie: string;
  let staffCookie: string;
  let customerACookie: string;
  let customerBCookie: string;
  let restrictedRoleId: string;
  let orderId: string;
  let shippingMethodId: string;
  let variantId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    // Register Customer A and B — sequential to avoid clearRateLimit races
    customerACookie = await signUpCustomer(prisma, CUSTOMER_A_EMAIL, SHARED_PASSWORD, {
      firstName: 'Alpha',
      lastName: 'Customer',
    });
    customerBCookie = await signUpCustomer(prisma, CUSTOMER_B_EMAIL, SHARED_PASSWORD, {
      firstName: 'Beta',
      lastName: 'Customer',
    });

    // A method that actually serves the destination, not `data[0]` of a list
    // ordered by sortOrder across every zone. See shippingMethodForCountry.
    shippingMethodId = await shippingMethodForCountry(adminCookie, STORE_ADDRESS.country);

    // Create a dedicated product + variant for rbac order tests so the test is
    // not affected by stock depletion from orders/returns suites that run earlier.
    const rbacProduct = await prisma.product.create({
      data: {
        name: { default: 'RBAC Test Widget', en: 'RBAC Test Widget' },
        slug: `rbac-test-widget-${Date.now()}`,
        description: { default: 'RBAC e2e test product' },
        status: 'ACTIVE',
        publishedAt: new Date(),
      },
    });
    const rbacVariant = await prisma.productVariant.create({
      data: { productId: rbacProduct.id, sku: `RBAC-SKU-${Date.now()}`, price: 50, isActive: true },
    });
    variantId = rbacVariant.id;

    // Seed stock at any active inventory location
    const location = await prisma.inventoryLocation.findFirst({ where: { isActive: true } });
    if (location) {
      await prisma.stockLevel.create({
        data: { variantId, locationId: location.id, onHand: 10, reserved: 0 },
      });
    }

    // Create a role with orders:view only
    const roleRes = await api()
      .post('/v1/admin/roles')
      .set('Cookie', adminCookie)
      .send({
        name: `rbac-limited-${Date.now()}`,
        description: 'Limited role for RBAC E2E test',
        permissions: ['orders:view'],
      })
      .expect(201);
    restrictedRoleId = roleRes.body.data.id;

    // Create staff with that role
    await api()
      .post('/v1/admin/staff')
      .set('Cookie', adminCookie)
      .send({
        email: STAFF_EMAIL,
        password: STAFF_PASSWORD,
        firstName: 'Limited',
        lastName: 'Staff',
        role: 'SUPPORT',
        roleId: restrictedRoleId,
      })
      .expect(201);

    staffCookie = await loginAs(STAFF_EMAIL, STAFF_PASSWORD);

    // Customer A places an order
    await api()
      .post('/v1/cart/items')
      .set('Cookie', customerACookie)
      .send({ variantId, quantity: 1 })
      .expect(200);

    const orderRes = await api()
      .post('/v1/orders')
      .set('Cookie', customerACookie)
      .set('X-Idempotency-Key', crypto.randomUUID())
      .send({ shippingAddress: STORE_ADDRESS, shippingMethodId })
      .expect(201);
    orderId = orderRes.body.data.id;
    // Two sign-ups with rate-limit clearing, a product, a variant, a cart and an
    // order: this hook has always needed far more than the default timeout, and
    // without one it aborted before the first test ran, so the whole suite was
    // red in every baseline. The sibling suites that do comparable setup all
    // pass one (audit-log-actor 30s, orders 60s, returns 90s).
  }, 60_000);

  afterAll(async () => {
    try {
      await prisma.user.deleteMany({
        where: {
          email: {
            in: [
              STAFF_EMAIL.toLowerCase(),
              CUSTOMER_A_EMAIL.toLowerCase(),
              CUSTOMER_B_EMAIL.toLowerCase(),
            ],
          },
        },
      });
      if (restrictedRoleId) {
        // Roles don't have a hard-delete endpoint in RBAC; rely on cascade or leave it
      }
      // Clean up rbac-specific product (created to avoid stock depletion cross-test)
      await prisma.stockLevel.deleteMany({ where: { variantId } }).catch(() => {});
      await prisma.productVariant
        .deleteMany({ where: { sku: { startsWith: 'RBAC-SKU-' } } })
        .catch(() => {});
      await prisma.product
        .deleteMany({ where: { slug: { startsWith: 'rbac-test-widget-' } } })
        .catch(() => {});
    } catch {
      // ignore
    }
    await prisma.$disconnect();
  });

  // ── Scenario A: Staff permission checks ──────────────────────────────────────

  describe('Staff with orders:view permission only', () => {
    it('GET /v1/admin/orders — staff can list orders (has orders:view)', async () => {
      const res = await api().get('/v1/admin/orders').set('Cookie', staffCookie).expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
    });

    it('DELETE /v1/admin/products/:id — staff is denied (missing products:delete) → 403', async () => {
      // Use a syntactically valid UUID; PermissionsGuard fires before the handler
      await api()
        .delete(`/v1/admin/products/00000000-0000-0000-0000-000000000001`)
        .set('Cookie', staffCookie)
        .expect(403);
    });

    it('POST /v1/admin/products — staff is denied (missing products:create) → 403', async () => {
      await api()
        .post('/v1/admin/products')
        .set('Cookie', staffCookie)
        .send({
          name: { default: 'Hack' },
          slug: 'hack-product',
          description: { default: 'x' },
          shortDescription: { default: 'x' },
          productTypeId: '00000000-0000-0000-0000-000000000001',
        })
        .expect(403);
    });

    it('POST /v1/admin/staff — staff is denied (missing staff:manage) → 403', async () => {
      await api()
        .post('/v1/admin/staff')
        .set('Cookie', staffCookie)
        .send({
          email: `blocked-staff-${Date.now()}@e2e.test`,
          password: 'BlockedStaff1!',
          firstName: 'Blocked',
          lastName: 'Staff',
          role: 'SUPPORT',
          roleId: restrictedRoleId,
        })
        .expect(403);
    });
  });

  // ── Scenario B: Customer cannot access admin endpoints ───────────────────────

  describe('Customer role boundary', () => {
    it('GET /v1/admin/orders — customer session is denied → 403', async () => {
      await api().get('/v1/admin/orders').set('Cookie', customerACookie).expect(403);
    });
  });

  // ── Scenario C: Unauthenticated access ───────────────────────────────────────

  describe('Unauthenticated access', () => {
    it('GET /v1/orders — no session returns 401', async () => {
      await api().get('/v1/orders').expect(401);
    });
  });

  // ── Scenario D: Customer ownership guard ────────────────────────────────────

  describe('Customer ownership', () => {
    it("GET /v1/orders/:id — Customer B cannot read Customer A's order → 403", async () => {
      await api().get(`/v1/orders/${orderId}`).set('Cookie', customerBCookie).expect(403);
    });

    it('GET /v1/orders/:id — Customer A can read their own order → 200', async () => {
      const res = await api()
        .get(`/v1/orders/${orderId}`)
        .set('Cookie', customerACookie)
        .expect(200);

      expect(res.body.data.id).toBe(orderId);
    });
  });
});
