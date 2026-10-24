import { ProductStatus, PrismaClient } from '@prisma/client';
import {
  api,
  createTestPrisma,
  STORE_DEFAULT_LOCALE,
  STORE_SECONDARY_LOCALE,
} from '../../../test/e2e/helpers';

/**
 * The catalogue sort control offers Newest, Price low to high, Price high to
 * low and Name A to Z, and for a long time only Newest did anything: the
 * storefront emitted `sortBy=price` / `sortBy=name`, the API allowlist held
 * neither, and `listProducts` fell back to `sortOrder` without saying so. Every
 * unit spec asserted the emitted key, so the whole set stayed green through it.
 *
 * These assert the RETURNED order. A spec that reads the query string cannot
 * fail on this defect, which is the entire reason it survived.
 *
 * The fixtures are pinned to their own category so the assertions are exact
 * rather than "contains, in some order" against whatever the seed holds.
 */

const CAT_SLUG = 'e2e-sort-category';
const SLUG_PREFIX = 'e2e-sort-product-';

// Ordering keys, chosen so price order, default-locale name order and
// secondary-locale name order are three DIFFERENT permutations. A sort that
// quietly ignores the request cannot satisfy more than one of them by
// accident. Keyed by the store's own locale pair, not a literal fr/en:
// gulf-rtl ships ar/en and a JSONB write with only fr/en keys would leave the
// default-locale rung empty for it.
const FIXTURES = [
  {
    key: 'a',
    name: {
      default: 'Zinc bur',
      [STORE_DEFAULT_LOCALE]: 'Zinc bur',
      [STORE_SECONDARY_LOCALE]: 'Alesoir zinc',
    },
    // Two variants: the card shows the DEFAULT one (300), not the cheapest
    // (50). A min-price sort would put this product first under `asc`.
    variants: [
      { sku: 'E2E-SORT-A1', price: 300, isDefault: true },
      { sku: 'E2E-SORT-A2', price: 50, isDefault: false },
    ],
  },
  {
    key: 'b',
    name: {
      default: 'Alpha bur',
      [STORE_DEFAULT_LOCALE]: 'Alpha bur',
      [STORE_SECONDARY_LOCALE]: 'Zircone alpha',
    },
    variants: [{ sku: 'E2E-SORT-B1', price: 100, isDefault: true }],
  },
  {
    key: 'c',
    name: {
      default: 'Middle bur',
      [STORE_DEFAULT_LOCALE]: 'Middle bur',
      [STORE_SECONDARY_LOCALE]: 'Middle bur',
    },
    variants: [{ sku: 'E2E-SORT-C1', price: 200, isDefault: true }],
  },
  {
    key: 'd',
    name: {
      default: 'Nolan bur',
      [STORE_DEFAULT_LOCALE]: 'Nolan bur',
      [STORE_SECONDARY_LOCALE]: 'Nolan bur',
    },
    // No active variant, so no price to sort on.
    variants: [{ sku: 'E2E-SORT-D1', price: 999, isDefault: true, isActive: false }],
  },
];

const slugOf = (key: string) => `${SLUG_PREFIX}${key}`;

describe('Catalogue sort (e2e)', () => {
  let prisma: PrismaClient;
  let categoryId: string;

  async function purge(): Promise<void> {
    const stale = await prisma.product.findMany({
      where: { slug: { startsWith: SLUG_PREFIX } },
      select: { id: true },
    });
    const ids = stale.map((p) => p.id);
    if (ids.length) {
      await prisma.productCategory.deleteMany({ where: { productId: { in: ids } } });
      await prisma.productVariant.deleteMany({ where: { productId: { in: ids } } });
      await prisma.product.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.category.deleteMany({ where: { slug: CAT_SLUG } });
  }

  /** Slugs in the order the API returned them, which is the assertion. */
  async function slugsFor(
    params: Record<string, string | number>,
    locale: string,
  ): Promise<string[]> {
    const query = new URLSearchParams({
      categoryId,
      pageSize: '10',
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    });
    const res = await api().get(`/v1/products?${query.toString()}`).set('X-Locale', locale);
    expect(res.status).toBe(200);
    return (res.body.data as Array<{ slug: string }>).map((p) => p.slug);
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    await purge();

    const category = await prisma.category.create({
      data: {
        name: {
          default: 'E2E sort',
          [STORE_DEFAULT_LOCALE]: 'E2E sort',
          [STORE_SECONDARY_LOCALE]: 'Tri E2E',
        },
        slug: CAT_SLUG,
        isVisible: true,
      },
    });
    categoryId = category.id;

    for (const fixture of FIXTURES) {
      const product = await prisma.product.create({
        data: {
          name: fixture.name,
          slug: slugOf(fixture.key),
          status: ProductStatus.ACTIVE,
          publishedAt: new Date(),
        },
      });
      await prisma.productCategory.create({
        data: { productId: product.id, categoryId },
      });
      for (const variant of fixture.variants) {
        await prisma.productVariant.create({
          data: {
            productId: product.id,
            sku: variant.sku,
            price: variant.price,
            isDefault: variant.isDefault,
            isActive: variant.isActive ?? true,
          },
        });
      }
    }
  });

  afterAll(async () => {
    await purge();
    await prisma.$disconnect();
  });

  // ── Price ──────────────────────────────────────────────────────────────────

  it('orders low to high on the price the card shows, not the cheapest variant', async () => {
    // b=100, c=200, a=300 (a also carries a 50 non-default variant), d unpriced.
    expect(await slugsFor({ sortBy: 'price', sortOrder: 'asc' }, STORE_DEFAULT_LOCALE)).toEqual([
      slugOf('b'),
      slugOf('c'),
      slugOf('a'),
      slugOf('d'),
    ]);
  });

  it('orders high to low on price', async () => {
    expect(await slugsFor({ sortBy: 'price', sortOrder: 'desc' }, STORE_DEFAULT_LOCALE)).toEqual([
      slugOf('a'),
      slugOf('c'),
      slugOf('b'),
      slugOf('d'),
    ]);
  });

  it('keeps a product with no active variant last in BOTH directions', async () => {
    const asc = await slugsFor({ sortBy: 'price', sortOrder: 'asc' }, STORE_DEFAULT_LOCALE);
    const desc = await slugsFor({ sortBy: 'price', sortOrder: 'desc' }, STORE_DEFAULT_LOCALE);

    expect(asc[asc.length - 1]).toBe(slugOf('d'));
    expect(desc[desc.length - 1]).toBe(slugOf('d'));
  });

  it('pages a price sort without repeating or skipping a row', async () => {
    const whole = await slugsFor({ sortBy: 'price', sortOrder: 'asc' }, STORE_DEFAULT_LOCALE);
    const first = await slugsFor(
      { sortBy: 'price', sortOrder: 'asc', pageSize: 2, page: 1 },
      STORE_DEFAULT_LOCALE,
    );
    const second = await slugsFor(
      { sortBy: 'price', sortOrder: 'asc', pageSize: 2, page: 2 },
      STORE_DEFAULT_LOCALE,
    );

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect([...first, ...second]).toEqual(whole);
  });

  // ── Name ───────────────────────────────────────────────────────────────────

  it('orders A to Z on the name of the requested locale, not on the JSONB blob', async () => {
    // store default locale: Alpha, Middle, Nolan, Zinc.
    expect(await slugsFor({ sortBy: 'name', sortOrder: 'asc' }, STORE_DEFAULT_LOCALE)).toEqual([
      slugOf('b'),
      slugOf('c'),
      slugOf('d'),
      slugOf('a'),
    ]);

    // store secondary locale: Alesoir, Middle, Nolan, Zircone. A different
    // permutation of the same rows, which a jsonb `ORDER BY name` cannot
    // produce: it compares the whole object and lands on one locale's value
    // for every request.
    expect(await slugsFor({ sortBy: 'name', sortOrder: 'asc' }, STORE_SECONDARY_LOCALE)).toEqual([
      slugOf('a'),
      slugOf('c'),
      slugOf('d'),
      slugOf('b'),
    ]);
  });

  it('reverses the name order on desc', async () => {
    expect(await slugsFor({ sortBy: 'name', sortOrder: 'desc' }, STORE_DEFAULT_LOCALE)).toEqual([
      slugOf('a'),
      slugOf('d'),
      slugOf('c'),
      slugOf('b'),
    ]);
  });

  // ── Envelope ───────────────────────────────────────────────────────────────

  it('reports the filtered total, not the page length, on a computed sort', async () => {
    const res = await api()
      .get(`/v1/products?categoryId=${categoryId}&sortBy=price&sortOrder=asc&pageSize=2`)
      .set('X-Locale', STORE_DEFAULT_LOCALE);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.total).toBe(FIXTURES.length);
    expect(res.body.meta.totalPages).toBe(2);
  });

  it('still falls back to the default order for a field outside the allowlist', async () => {
    const bogus = await slugsFor({ sortBy: 'costPrice', sortOrder: 'asc' }, STORE_DEFAULT_LOCALE);
    const fallback = await slugsFor(
      { sortBy: 'sortOrder', sortOrder: 'asc' },
      STORE_DEFAULT_LOCALE,
    );

    expect(bogus).toEqual(fallback);
  });
});
