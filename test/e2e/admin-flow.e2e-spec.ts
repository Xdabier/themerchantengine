/**
 * Admin Flow E2E
 *
 * Admin creates product with variants →
 * sets stock via inventory adjust →
 * customer places order →
 * admin views order → updates status →
 * views analytics dashboard → verifies order appears in stats
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

const CUSTOMER_EMAIL = `admin-flow-${crypto.randomUUID()}@e2e.test`;
const CUSTOMER_PASSWORD = 'AdminFlow1!';
const PRODUCT_SLUG = `admin-flow-product-${Date.now()}`;

describe('Admin Flow (e2e)', () => {
  let prisma: PrismaClient;

  let adminCookie: string;
  let customerCookie: string;
  let productId: string;
  let variantId: string;
  let variantSku: string;
  let assetId: string;
  let locationId: string;
  let shippingMethodId: string;
  let orderId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    // Register test customer
    customerCookie = await signUpCustomer(prisma, CUSTOMER_EMAIL, CUSTOMER_PASSWORD, {
      firstName: 'Admin',
      lastName: 'FlowCustomer',
    });

    // A method that actually serves the destination, not `data[0]` of a list
    // ordered by sortOrder across every zone. See shippingMethodForCountry.
    shippingMethodId = await shippingMethodForCountry(adminCookie, STORE_ADDRESS.country);
    expect(shippingMethodId).toBeDefined();

    // Get default inventory location
    const locRes = await api()
      .get('/v1/admin/inventory/locations')
      .set('Cookie', adminCookie)
      .expect(200);
    locationId = locRes.body.data[0]?.id;
  });

  afterAll(async () => {
    try {
      // Soft-delete the test product (admin delete endpoint)
      if (productId) {
        await api().delete(`/v1/admin/products/${productId}`).set('Cookie', adminCookie);
      }
      // ProductAsset cascades on product delete, but Asset uses
      // onDelete: Restrict — sweep the orphan asset row directly.
      if (assetId) {
        await prisma.asset.delete({ where: { id: assetId } }).catch(() => undefined);
      }
      await prisma.user.deleteMany({ where: { email: CUSTOMER_EMAIL } });
    } catch {
      // ignore
    }
    await prisma.$disconnect();
  });

  // ── 1. Get a product type to use ─────────────────────────────────────────────

  it('GET /v1/admin/product-types — returns at least one type', async () => {
    const res = await api().get('/v1/admin/product-types').set('Cookie', adminCookie).expect(200);

    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  // ── 2. Admin creates product ─────────────────────────────────────────────────

  it('POST /v1/admin/products — admin creates a new product', async () => {
    // Resolve a product type first
    const typesRes = await api()
      .get('/v1/admin/product-types')
      .set('Cookie', adminCookie)
      .expect(200);
    const productTypeId = typesRes.body.data[0].id;

    const res = await api()
      .post('/v1/admin/products')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'Chemise Admin Flow', en: 'Admin Flow Shirt' },
        slug: PRODUCT_SLUG,
        description: { default: 'Un produit de test.', en: 'A test product.' },
        shortDescription: { default: 'Chemise de test.', en: 'Test shirt.' },
        productTypeId,
        brand: 'TestBrand',
        isFeatured: false,
      })
      .expect(201);

    expect(res.body.data.slug).toBe(PRODUCT_SLUG);
    productId = res.body.data.id;
  });

  // ── 3. Admin creates variant ─────────────────────────────────────────────────

  it('POST /v1/admin/products/:id/variants — admin adds a variant', async () => {
    const res = await api()
      .post(`/v1/admin/products/${productId}/variants`)
      .set('Cookie', adminCookie)
      .send({
        sku: `ADMIN-FLOW-${Date.now()}`,
        price: 99.0,
        compareAtPrice: 129.0,
        weight: 0.3,
        attributeValueIds: [],
        isDefault: true,
      })
      .expect(201);

    expect(res.body.data.sku).toBeDefined();
    variantId = res.body.data.id;
    variantSku = res.body.data.sku;
  });

  // ── 3a. Admin product list honours the declared search param (QA C2) ─────────

  it('GET /v1/admin/products?search= — filters by slug, sku, and brand', async () => {
    const unfiltered = await api()
      .get('/v1/admin/products?pageSize=1')
      .set('Cookie', adminCookie)
      .expect(200);

    const bySlug = await api()
      .get(`/v1/admin/products?search=${encodeURIComponent(PRODUCT_SLUG)}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(bySlug.body.data.map((p: { id: string }) => p.id)).toContain(productId);
    expect(bySlug.body.meta.total).toBeLessThan(unfiltered.body.meta.total);

    const bySku = await api()
      .get(`/v1/admin/products?search=${encodeURIComponent(variantSku)}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(bySku.body.data.map((p: { id: string }) => p.id)).toContain(productId);

    const byBrand = await api()
      .get('/v1/admin/products?search=testbrand')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(byBrand.body.data.map((p: { id: string }) => p.id)).toContain(productId);

    const noMatch = await api()
      .get('/v1/admin/products?search=zzz-no-such-product')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(noMatch.body.data).toEqual([]);
    expect(noMatch.body.meta.total).toBe(0);
  });

  // ── 3a-bis. The Translatable name itself is searchable (QA D3) ──────────────

  it('GET /v1/admin/products?search= matches the Translatable name on default and en', async () => {
    // The slug is minted from the EN name, so a term that appears only in the
    // French `default` value proves the JSONB name clauses are what is
    // matching, not the slug proxy.
    const byDefaultName = await api()
      .get(`/v1/admin/products?search=${encodeURIComponent('Chemise')}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(byDefaultName.body.data.map((p: { id: string }) => p.id)).toContain(productId);

    const byEnglishName = await api()
      .get(`/v1/admin/products?search=${encodeURIComponent('Flow Shirt')}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(byEnglishName.body.data.map((p: { id: string }) => p.id)).toContain(productId);
  });

  // ── 3b. Admin assigns an asset to the product (S16.1 — nested envelope check) ─

  it('PATCH /v1/admin/products/:id/assets — admin links an asset', async () => {
    const created = await prisma.asset.create({
      data: {
        url: 'https://cdn.test.local/admin-flow-asset.jpg',
        type: 'IMAGE',
        mimeType: 'image/jpeg',
        fileSize: 4096,
        width: 800,
        height: 600,
        status: 'READY',
        storagePath: `e2e/admin-flow/${crypto.randomUUID()}.jpg`,
        alt: { default: 'Vignette chemise admin flow', fr: 'Chemise', en: 'Shirt' },
      },
    });
    assetId = created.id;

    await api()
      .patch(`/v1/admin/products/${productId}/assets`)
      .set('Cookie', adminCookie)
      .send({ assets: [{ assetId, sortOrder: 0, isPrimary: true }] })
      .expect(204);
  });

  it('GET /v1/admin/products/:id — surfaces nested asset envelope on assets[]', async () => {
    const res = await api()
      .get(`/v1/admin/products/${productId}`)
      .set('Cookie', adminCookie)
      .expect(200);

    type AssetJoinShape = {
      assetId: string;
      isPrimary: boolean;
      sortOrder: number;
      asset: {
        id: string;
        url: string;
        type: string;
        alt: string | Record<string, string> | null;
        status: string;
        mimeType: string;
        fileSize: number;
        width: number | null;
        height: number | null;
      };
    };
    const assets = (res.body.data as { assets: AssetJoinShape[] }).assets;
    expect(assets).toHaveLength(1);
    expect(assets[0].assetId).toBe(assetId);
    expect(assets[0].isPrimary).toBe(true);
    expect(assets[0].asset).toBeDefined();
    expect(assets[0].asset.id).toBe(assetId);
    expect(assets[0].asset.url).toBe('https://cdn.test.local/admin-flow-asset.jpg');
    expect(assets[0].asset.type).toBe('IMAGE');
    expect(assets[0].asset.status).toBe('READY');
    expect(assets[0].asset.mimeType).toBe('image/jpeg');
    expect(assets[0].asset.fileSize).toBe(4096);
    expect(assets[0].asset.width).toBe(800);
    expect(assets[0].asset.height).toBe(600);
    // Without Accept-Language and without X-Resolve-Locale, the global
    // TranslatableInterceptor narrows to the 'default' key.
    expect(assets[0].asset.alt).toBe('Vignette chemise admin flow');
  });

  it('GET /v1/admin/products/:id with X-Resolve-Locale: false returns full Translatable alt', async () => {
    const res = await api()
      .get(`/v1/admin/products/${productId}`)
      .set('Cookie', adminCookie)
      .set('X-Resolve-Locale', 'false')
      .expect(200);

    const assets = (res.body.data as { assets: { asset: { alt: Record<string, string> } }[] })
      .assets;
    expect(typeof assets[0].asset.alt).toBe('object');
    expect(assets[0].asset.alt).toMatchObject({
      default: 'Vignette chemise admin flow',
      fr: 'Chemise',
      en: 'Shirt',
    });
  });

  it('GET /v1/admin/products/:id with Accept-Language: en resolves alt to the en value', async () => {
    // 'en' rather than the asset's other stored key ('fr'): every scenario
    // fixture (demo, maghreb-ltr, gulf-rtl) ships 'en', 'fr' does not (gulf-rtl
    // is ar/en), so this is the one key guaranteed resolvable under all three.
    const res = await api()
      .get(`/v1/admin/products/${productId}`)
      .set('Cookie', adminCookie)
      .set('Accept-Language', 'en')
      .expect(200);

    const assets = (res.body.data as { assets: { asset: { alt: string } }[] }).assets;
    expect(assets[0].asset.alt).toBe('Shirt');
  });

  // ── 4. Admin sets stock via inventory adjust ─────────────────────────────────

  it('PATCH /v1/admin/inventory/adjust — admin sets stock to 10', async () => {
    await api()
      .patch('/v1/admin/inventory/adjust')
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', crypto.randomUUID())
      .send({
        variantId,
        locationId,
        quantity: 10,
        reason: 'RECEIVED',
        notes: 'Initial stock for E2E test',
      })
      .expect(200);
    // adjustInventory returns void — just verify 200 status
  });

  it('GET /v1/admin/inventory/variant/:id — stock is reflected', async () => {
    const res = await api()
      .get(`/v1/admin/inventory/variant/${variantId}`)
      .set('Cookie', adminCookie)
      .expect(200);

    // `{ variant, levels }`, not a bare array. See inventory.e2e-spec.ts.
    expect(res.body.data.variant.id).toBe(variantId);
    expect(res.body.data.levels).toBeInstanceOf(Array);
    const total = res.body.data.levels.reduce((sum: number, l: any) => sum + (l.onHand ?? 0), 0);
    expect(total).toBeGreaterThanOrEqual(10);
  });

  // ── 5. Customer places order for the new product ─────────────────────────────

  it('POST /v1/cart/items + POST /v1/orders — customer orders the new product', async () => {
    await api()
      .post('/v1/cart/items')
      .set('Cookie', customerCookie)
      .send({ variantId, quantity: 1 })
      .expect(200);

    const orderRes = await api()
      .post('/v1/orders')
      .set('Cookie', customerCookie)
      .set('X-Idempotency-Key', crypto.randomUUID())
      .send({ shippingAddress: STORE_ADDRESS, shippingMethodId })
      .expect(201);

    expect(orderRes.body.data.id).toBeDefined();
    orderId = orderRes.body.data.id;
  });

  // ── 6. Admin views order ─────────────────────────────────────────────────────

  it('GET /v1/admin/orders/:id — admin can view the order', async () => {
    const res = await api()
      .get(`/v1/admin/orders/${orderId}`)
      .set('Cookie', adminCookie)
      .expect(200);

    expect(res.body.data.id).toBe(orderId);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.items).toBeInstanceOf(Array);
  });

  // ── 7. Admin updates order status ────────────────────────────────────────────

  it('PATCH /v1/admin/orders/:id/status — admin confirms then processes order', async () => {
    await api()
      .patch(`/v1/admin/orders/${orderId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'CONFIRMED' })
      .expect(200);

    const res = await api()
      .patch(`/v1/admin/orders/${orderId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'PROCESSING' })
      .expect(200);

    expect(res.body.data.status).toBe('PROCESSING');
  });

  // ── 8. Admin views analytics dashboard ──────────────────────────────────────

  it('GET /v1/admin/analytics/dashboard — returns aggregated metrics', async () => {
    const res = await api()
      .get('/v1/admin/analytics/dashboard')
      .set('Cookie', adminCookie)
      .expect(200);

    expect(res.body.data).toBeDefined();
    // Dashboard returns period buckets with order counts and revenue
    const data = res.body.data;
    expect(data.today ?? data.thisMonth ?? data.total).toBeDefined();
  });

  // ── 9. Order appears in admin orders list ────────────────────────────────────

  it('GET /v1/admin/orders — the placed order appears in list', async () => {
    const res = await api()
      .get('/v1/admin/orders')
      .set('Cookie', adminCookie)
      .query({ page: 1, pageSize: 50 })
      .expect(200);

    expect(res.body.data).toBeInstanceOf(Array);
    const found = res.body.data.find((o: any) => o.id === orderId);
    expect(found).toBeDefined();
  });
});
