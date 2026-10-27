/**
 * Public brand facets (plan L Phase L5, finding C11 and the prior pass's C5).
 *
 * The catalogue rail used to derive its brand list from the products on screen,
 * which is a page-1 sample of the already-filtered result: pick a brand and the
 * sample holds one brand, so the facet collapsed to the selection. The endpoint
 * under test answers over the whole ACTIVE catalogue, so the rail can keep
 * every brand on screen no matter what is selected.
 *
 * Real dockerized DB per constitution 3.8. Every expectation is derived from
 * the seeded rows rather than hardcoded, so a reseed cannot silently turn an
 * assertion into a tautology.
 */
import { PrismaClient } from '@prisma/client';
import { api, createTestPrisma, flushRedisKeys } from './helpers';

interface BrandFacet {
  brand: string;
  count: number;
}

describe('GET /v1/products/brands', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrisma();
    // The endpoint caches for 5 minutes; without a flush this spec reads
    // whatever an earlier run left behind.
    await flushRedisKeys('products:brand-facets:*');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Brands of every ACTIVE, non-deleted product, counted straight from the DB. */
  async function expectedBrands(categoryId?: string): Promise<Map<string, number>> {
    const rows = await prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        ...(categoryId ? { categories: { some: { categoryId } } } : {}),
      },
      select: { brand: true },
    });
    const counts = new Map<string, number>();
    for (const row of rows) {
      const brand = row.brand?.trim();
      if (!brand) continue;
      counts.set(brand, (counts.get(brand) ?? 0) + 1);
    }
    return counts;
  }

  it('answers 200 with every brand of the ACTIVE catalogue and its count', async () => {
    const res = await api().get('/v1/products/brands').expect(200);
    const facets = res.body.data as BrandFacet[];
    expect(Array.isArray(facets)).toBe(true);

    const expected = await expectedBrands();
    expect(new Map(facets.map((f) => [f.brand, f.count]))).toEqual(expected);
  });

  it('never emits a blank or whitespace-only brand', async () => {
    const res = await api().get('/v1/products/brands').expect(200);
    const facets = res.body.data as BrandFacet[];
    for (const facet of facets) {
      expect(facet.brand.trim()).not.toBe('');
    }
  });

  it('orders by count, then by brand name', async () => {
    const res = await api().get('/v1/products/brands').expect(200);
    const facets = res.body.data as BrandFacet[];
    const sorted = [...facets].sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand));
    expect(facets).toEqual(sorted);
  });

  it('scopes to a category and returns a subset of the unscoped list', async () => {
    const category = await prisma.category.findFirst({
      where: {
        deletedAt: null,
        products: {
          some: { product: { status: 'ACTIVE', deletedAt: null, brand: { not: null } } },
        },
      },
      select: { id: true },
    });
    if (!category) throw new Error('no seeded category holds an ACTIVE product with a brand');

    await flushRedisKeys('products:brand-facets:*');
    const res = await api()
      .get('/v1/products/brands')
      .query({ categoryId: category.id })
      .expect(200);
    const facets = res.body.data as BrandFacet[];

    const expected = await expectedBrands(category.id);
    expect(new Map(facets.map((f) => [f.brand, f.count]))).toEqual(expected);

    const allRes = await api().get('/v1/products/brands').expect(200);
    const allBrands = new Set((allRes.body.data as BrandFacet[]).map((f) => f.brand));
    for (const facet of facets) {
      expect(allBrands.has(facet.brand)).toBe(true);
    }
  });

  it('returns an empty list for a category nothing belongs to', async () => {
    await flushRedisKeys('products:brand-facets:*');
    const res = await api()
      .get('/v1/products/brands')
      .query({ categoryId: '00000000-0000-4000-8000-000000000000' })
      .expect(200);
    expect(res.body.data).toEqual([]);
  });

  it('rejects an over-long categoryId rather than querying with it', async () => {
    await api()
      .get('/v1/products/brands')
      .query({ categoryId: 'x'.repeat(65) })
      .expect(400);
  });

  it('is not shadowed by the products/:slug route', async () => {
    const res = await api().get('/v1/products/brands').expect(200);
    // A slug match would answer 404, or 200 with a product detail object.
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
