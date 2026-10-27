import { randomUUID } from 'crypto';
import { AdjustmentReason, MovementType, PrismaClient } from '@prisma/client';
import { api, createTestPrisma, createUserWithRole, loginAs } from '../../../test/e2e/helpers';

// ── Constants ──────────────────────────────────────────────────────────────────

const TEST_SUFFIX = '@e2e-inventory.test';
const TEST_PASSWORD = 'StrongPass1';

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Inventory (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;

  // IDs created during the run
  let locationId: string;
  let location2Id: string;
  let variantId: string;
  // A second variant that never receives stock. Its only job is to prove the
  // endpoint still names the product when there are no StockLevel rows.
  let stocklessVariantId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();

    // ── Clean up previous runs ────────────────────────────────────────────────
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: 'E2E-Inventory-' } } });
    // Delete StockLevel + InventoryMovement rows first — they FK-reference the
    // E2E locations and would otherwise block the location delete.
    const e2eLocations = await prisma.inventoryLocation.findMany({
      where: { code: { startsWith: 'E2E-' } },
      select: { id: true },
    });
    const e2eLocationIds = e2eLocations.map((l) => l.id);
    if (e2eLocationIds.length > 0) {
      await prisma.inventoryMovement.deleteMany({
        where: { locationId: { in: e2eLocationIds } },
      });
      await prisma.stockLevel.deleteMany({ where: { locationId: { in: e2eLocationIds } } });
    }
    await prisma.inventoryLocation.deleteMany({ where: { code: { startsWith: 'E2E-' } } });

    // ── Create admin user with inventory permissions ──────────────────────────
    await createUserWithRole(prisma, {
      email: `admin${TEST_SUFFIX}`,
      password: TEST_PASSWORD,
      role: 'ADMIN',
      // Full inventory permission set per docs/admin-api-reference.md:
      // inventory:create (locations), inventory:update (adjust/transfer/update-location),
      // inventory:delete (delete locations), inventory:view (list/get)
      permissions: ['inventory:view', 'inventory:create', 'inventory:update', 'inventory:delete'],
      firstName: 'Inventory',
      lastName: 'Admin',
    });

    // ── Create a product + variant for stock ops ──────────────────────────────
    const productType = await prisma.productType.create({
      data: { name: { default: 'Widget', fr: 'Widget', en: 'Widget' }, code: 'e2e-inv-type' },
    });

    const product = await prisma.product.create({
      data: {
        name: { default: 'E2E Inv Product', fr: 'E2E Inv Product', en: 'E2E Inv Product' },
        slug: 'e2e-inv-product',
        productTypeId: productType.id,
      },
    });

    const variant = await prisma.productVariant.create({
      data: { productId: product.id, sku: 'E2E-INV-SKU-001', price: 9.99 },
    });
    variantId = variant.id;

    const stocklessVariant = await prisma.productVariant.create({
      data: { productId: product.id, sku: 'E2E-INV-SKU-002', price: 19.99 },
    });
    stocklessVariantId = stocklessVariant.id;

    adminCookie = await loginAs(`admin${TEST_SUFFIX}`, TEST_PASSWORD);
  });

  afterAll(async () => {
    await prisma.inventoryMovement.deleteMany({ where: { variantId } });
    await prisma.stockLevel.deleteMany({ where: { variantId } });
    await prisma.inventoryLocation.deleteMany({ where: { code: { startsWith: 'E2E-' } } });
    await prisma.productVariant.deleteMany({ where: { sku: { startsWith: 'E2E-INV-SKU-' } } });
    await prisma.product.deleteMany({ where: { slug: 'e2e-inv-product' } });
    await prisma.productType.deleteMany({ where: { code: 'e2e-inv-type' } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: 'E2E-Inventory-' } } });
    await prisma.$disconnect();
  });

  // ── 1. Create locations ────────────────────────────────────────────────────

  it('POST /v1/admin/inventory/locations — creates a location', async () => {
    const res = await api()
      .post('/v1/admin/inventory/locations')
      .set('Cookie', adminCookie)
      .send({ name: 'E2E Main Warehouse', code: 'E2E-WH-MAIN' });

    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe('E2E-WH-MAIN');
    locationId = res.body.data.id as string;
  });

  it('POST /v1/admin/inventory/locations — 409 on duplicate code', async () => {
    const res = await api()
      .post('/v1/admin/inventory/locations')
      .set('Cookie', adminCookie)
      .send({ name: 'Duplicate', code: 'E2E-WH-MAIN' });

    expect(res.status).toBe(409);
  });

  it('POST /v1/admin/inventory/locations — creates a second location', async () => {
    const res = await api()
      .post('/v1/admin/inventory/locations')
      .set('Cookie', adminCookie)
      .send({ name: 'E2E Store', code: 'E2E-STORE-01' });

    expect(res.status).toBe(201);
    location2Id = res.body.data.id as string;
  });

  // ── 2. Adjust inventory (add stock) ───────────────────────────────────────

  it('PATCH /v1/admin/inventory/adjust — adds 100 units to main warehouse', async () => {
    const res = await api()
      .patch('/v1/admin/inventory/adjust')
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', randomUUID())
      .send({
        variantId,
        locationId,
        quantity: 100,
        reason: AdjustmentReason.RECEIVED,
        notes: 'Initial stock receipt',
      });

    expect(res.status).toBe(200);
  });

  it('PATCH /v1/admin/inventory/adjust — 400 when negative adjustment exceeds onHand', async () => {
    const res = await api()
      .patch('/v1/admin/inventory/adjust')
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', randomUUID())
      .send({
        variantId,
        locationId,
        quantity: -999,
        reason: AdjustmentReason.DAMAGE,
      });

    expect(res.status).toBe(400);
  });

  it('PATCH /v1/admin/inventory/adjust — 400 IDEMPOTENCY_KEY_REQUIRED without header', async () => {
    const res = await api()
      .patch('/v1/admin/inventory/adjust')
      .set('Cookie', adminCookie)
      .send({ variantId, locationId, quantity: 1, reason: AdjustmentReason.RECEIVED });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('PATCH /v1/admin/inventory/adjust — 400 IDEMPOTENCY_KEY_MALFORMED on bad header', async () => {
    const res = await api()
      .patch('/v1/admin/inventory/adjust')
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', 'not-a-uuid')
      .send({ variantId, locationId, quantity: 1, reason: AdjustmentReason.RECEIVED });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('IDEMPOTENCY_KEY_MALFORMED');
  });

  // ── 3. Check availability ─────────────────────────────────────────────────

  it('GET /v1/admin/inventory/variant/:variantId — shows 100 available', async () => {
    const res = await api()
      .get(`/v1/admin/inventory/variant/${variantId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const { levels } = res.body.data as {
      levels: Array<{ locationId: string; onHand: number; available: number }>;
    };
    const main = levels.find((l) => l.locationId === locationId);
    expect(main?.onHand).toBe(100);
    expect(main?.available).toBe(100);
  });

  // The endpoint answers with `{ variant, levels }`, not a bare array. The
  // wrapper is the contract: `getVariantStock` still returns the bare array for
  // the wishlist module, while this route feeds the admin variant-detail screen,
  // which needs the product identity even when no stock row exists. Asserted
  // positively so a silent reshape reds here instead of at the screen.
  it('GET /v1/admin/inventory/variant/:variantId — answers { variant, levels }', async () => {
    const res = await api()
      .get(`/v1/admin/inventory/variant/${variantId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(false);
    expect(res.body.data.variant).toMatchObject({
      id: variantId,
      sku: 'E2E-INV-SKU-001',
      product: { slug: 'e2e-inv-product' },
    });
    expect(Array.isArray(res.body.data.levels)).toBe(true);
  });

  it('GET /v1/admin/inventory/variant/:variantId — names the product with no stock rows', async () => {
    const res = await api()
      .get(`/v1/admin/inventory/variant/${stocklessVariantId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.levels).toEqual([]);
    expect(res.body.data.variant).toMatchObject({
      id: stocklessVariantId,
      sku: 'E2E-INV-SKU-002',
      product: { slug: 'e2e-inv-product' },
    });
  });

  // ── 4. List stock levels with filter ──────────────────────────────────────

  it('GET /v1/admin/inventory?variantId=... — returns stock for variant', async () => {
    const res = await api()
      .get(`/v1/admin/inventory?variantId=${variantId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  // ── 5. Transfer stock between locations ───────────────────────────────────

  it('POST /v1/admin/inventory/transfer — moves 30 units to second location', async () => {
    const res = await api()
      .post('/v1/admin/inventory/transfer')
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', randomUUID())
      .send({
        variantId,
        fromLocationId: locationId,
        toLocationId: location2Id,
        quantity: 30,
        notes: 'E2E transfer test',
      });

    expect(res.status).toBe(200);
  });

  it('POST /v1/admin/inventory/transfer — 400 on same-location transfer', async () => {
    const res = await api()
      .post('/v1/admin/inventory/transfer')
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', randomUUID())
      .send({ variantId, fromLocationId: locationId, toLocationId: locationId, quantity: 5 });

    expect(res.status).toBe(400);
  });

  it('POST /v1/admin/inventory/transfer — 400 IDEMPOTENCY_KEY_REQUIRED without header', async () => {
    const res = await api()
      .post('/v1/admin/inventory/transfer')
      .set('Cookie', adminCookie)
      .send({ variantId, fromLocationId: locationId, toLocationId: location2Id, quantity: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('POST /v1/admin/inventory/transfer — 400 IDEMPOTENCY_KEY_MALFORMED on bad header', async () => {
    const res = await api()
      .post('/v1/admin/inventory/transfer')
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', 'not-a-uuid')
      .send({ variantId, fromLocationId: locationId, toLocationId: location2Id, quantity: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('IDEMPOTENCY_KEY_MALFORMED');
  });

  // ── 6. Verify stock after transfer ────────────────────────────────────────

  it('GET /v1/admin/inventory/variant/:variantId — reflects transfer correctly', async () => {
    const res = await api()
      .get(`/v1/admin/inventory/variant/${variantId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const { levels } = res.body.data as {
      levels: Array<{ locationId: string; onHand: number }>;
    };
    const main = levels.find((l) => l.locationId === locationId);
    const store = levels.find((l) => l.locationId === location2Id);
    expect(main?.onHand).toBe(70);
    expect(store?.onHand).toBe(30);
  });

  // ── 7. Movement log ────────────────────────────────────────────────────────

  it('GET /v1/admin/inventory/movements — returns at least 3 movements', async () => {
    const res = await api()
      .get(`/v1/admin/inventory/movements?variantId=${variantId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    // 1× ADJUSTMENT (initial receive) + 2× TRANSFER
    expect(res.body.meta.total).toBeGreaterThanOrEqual(3);
  });

  it('GET /v1/admin/inventory/movements?type=TRANSFER — filters by type', async () => {
    const res = await api()
      .get(`/v1/admin/inventory/movements?variantId=${variantId}&type=${MovementType.TRANSFER}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
    for (const mv of res.body.data as Array<{ type: string }>) {
      expect(mv.type).toBe(MovementType.TRANSFER);
    }
  });

  // ── 8. Delete location blocked by stock ───────────────────────────────────

  it('DELETE /v1/admin/inventory/locations/:id — 400 when location holds stock', async () => {
    const res = await api()
      .delete(`/v1/admin/inventory/locations/${locationId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
  });

  // ── 9. Auth guard ─────────────────────────────────────────────────────────

  it('GET /v1/admin/inventory — 401 without token', async () => {
    const res = await api().get('/v1/admin/inventory');
    expect(res.status).toBe(401);
  });
});
