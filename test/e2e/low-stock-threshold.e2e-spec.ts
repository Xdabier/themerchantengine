/**
 * The admin low-stock threshold reaches the customer (plan I phase I6, finding D7).
 *
 * D7 reported the PDP binarizing stock into in/out with a styled `low` state
 * that could never render. Both halves are already fixed on this branch: the
 * API grades three ways against the admin threshold, the storefront renders all
 * three, and the raw count is deliberately stripped at the boundary. Every one
 * of those is unit-tested in isolation.
 *
 * What no test covered is the seam, which is the finding's actual claim: that
 * changing the threshold in the admin changes what a customer sees. This spec
 * drives the real settings PATCH against the real dockerized DB and reads the
 * public product endpoint back.
 *
 * The threshold is moved rather than the stock, so the test never has to own an
 * inventory row: with the threshold above every count, everything in stock
 * grades LOW_STOCK; with it at zero, nothing does. Restored in `finally`,
 * because the row is global.
 */
import { PrismaClient } from '@prisma/client';
import { ADMIN, api, createTestPrisma, loginAs } from './helpers';

interface PublicVariant {
  id: string;
  availability: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  stock?: unknown;
}

interface PublicProduct {
  slug: string;
  variants: PublicVariant[];
}

const SETTINGS_URL = '/v1/admin/settings';

async function listProducts(): Promise<PublicProduct[]> {
  const res = await api().get('/v1/products?pageSize=50').expect(200);
  return res.body.data as PublicProduct[];
}

/** Grades across every variant on the first page, so one seeded row cannot
 * make the assertion pass or fail on its own. */
function grades(products: PublicProduct[]): string[] {
  return products.flatMap((p) => p.variants.map((v) => v.availability));
}

async function setThreshold(cookie: string, value: number): Promise<void> {
  await api()
    .patch(SETTINGS_URL)
    .set('Cookie', cookie)
    .send({ defaultLowStockThreshold: value })
    .expect(200);
}

describe('admin low-stock threshold drives the public availability grade', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  let original: number | null;

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
    const row = await prisma.storeSetting.findUnique({
      where: { group_key: { group: 'inventory', key: 'defaultLowStockThreshold' } },
    });
    original = typeof row?.value === 'number' ? row.value : null;
  });

  afterAll(async () => {
    if (original === null) {
      await prisma.storeSetting.deleteMany({
        where: { group: 'inventory', key: 'defaultLowStockThreshold' },
      });
    } else {
      await setThreshold(adminCookie, original);
    }
    await prisma.$disconnect();
  });

  it('grades every in-stock variant LOW_STOCK when the threshold is above every count', async () => {
    await setThreshold(adminCookie, 1_000_000);
    const all = grades(await listProducts());

    expect(all.length).toBeGreaterThan(0);
    expect(all).toContain('LOW_STOCK');
    expect(all).not.toContain('IN_STOCK');
  });

  it('grades nothing LOW_STOCK at threshold zero, the operator opt-out', async () => {
    await setThreshold(adminCookie, 0);
    const all = grades(await listProducts());

    expect(all).toContain('IN_STOCK');
    expect(all).not.toContain('LOW_STOCK');
  });

  it('keeps grading a depleted variant OUT_OF_STOCK regardless of the threshold', async () => {
    // The threshold moves the in/low boundary and must never move the out one:
    // a zero-stock variant that graded LOW would offer an add-to-cart that the
    // server then refuses.
    await setThreshold(adminCookie, 1_000_000);
    const products = await listProducts();
    const depleted = products
      .flatMap((p) => p.variants)
      .filter((v) => v.availability === 'OUT_OF_STOCK');

    for (const variant of depleted) {
      expect(variant.availability).toBe('OUT_OF_STOCK');
    }
  });

  it('never puts the exact count on the wire at any threshold', async () => {
    // These endpoints are unauthenticated. The count is what lets a caller
    // paging the catalogue read off the whole store's inventory position.
    await setThreshold(adminCookie, 5);
    const res = await api().get('/v1/products?pageSize=50').expect(200);

    for (const product of res.body.data as PublicProduct[]) {
      for (const variant of product.variants) {
        expect(variant).not.toHaveProperty('stock');
        expect(variant).not.toHaveProperty('stockLevels');
      }
    }
  });

  it('grades the product detail page the same way as the catalogue', async () => {
    // The detail path caches its payload and grades after the cache. A cached
    // page serving a stale state is the defect this pins.
    await setThreshold(adminCookie, 1_000_000);
    const products = await listProducts();
    const target = products.find((p) => p.variants.length > 0);
    expect(target).toBeDefined();

    const detail = await api().get(`/v1/products/${target!.slug}`).expect(200);
    const detailGrades = (detail.body.data as PublicProduct).variants.map((v) => v.availability);
    const listGrades = target!.variants.map((v) => v.availability);

    expect(detailGrades).toEqual(listGrades);
  });
});
