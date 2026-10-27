import { Prisma, PrismaClient } from '@prisma/client';
import {
  STORE_CONFIG,
  STORE_DEFAULT_LOCALE,
  api,
  createTestPrisma,
  createUserWithRole,
  loginAs,
} from '../../../test/e2e/helpers';
import { TEST_DATABASE_URL } from '../../../test/e2e/env';
import { applyFtsSetup } from '../../../prisma/apply-fts-setup';

// ── Constants ────────────────────────────────────────────────────────────────

const TEST_SUFFIX = '@e2e-search.test';
const TEST_PASSWORD = 'StrongPass1!';

// ── Suite ────────────────────────────────────────────────────────────────────

describe('Search (e2e)', () => {
  // The `french` text-search segment is an engine capability; whether a store
  // can hold French copy is its enabled-locale set (plan E1.3.4).
  const frenchEnabled = (STORE_CONFIG.localization.supportedLocales as readonly string[]).includes(
    'fr',
  );
  const arabicEnabled = (STORE_CONFIG.localization.supportedLocales as readonly string[]).includes(
    'ar',
  );
  let prisma: PrismaClient;

  let adminCookie: string;
  let productShoesId: string;
  let productShirtId: string;
  let categoryId: string;
  let shoesSku: string;
  // Subtree-search fixture: a product filed ONLY under a child category.
  let parentCategoryId: string;
  let childCategoryId: string;
  let productBootId: string;
  // Null-tags regression fixture.
  let productNoTagsId: string;
  // French fixtures (D2). Accent-symmetry probe: the French name is the ONLY
  // place the queried word lives, so a hit can only come through the `french`
  // tsvector segment.
  let productFrAccentId: string;
  // Arabic fixture: the queried stem lives only in `name.ar`, so a hit can only
  // come through the `arabic` segment of the tsvector.
  let productArArticleId: string;
  // Ranking pair for the multi-word French query.
  let productFrRankId: string;
  let productFrDecoyId: string;
  // Accented Category / Brand ILIKE probes.
  let frCategoryId: string;
  let productFrCategoryId: string;
  let frBrandId: string;
  let productFrBrandId: string;

  // ── Setup ──────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    prisma = createTestPrisma();

    // Apply the REAL production FTS setup (prisma/search_fts_setup.sql) — column,
    // trigger, indexes, backfill — so the e2e exercises the same index as prod
    // (no more divergent simplified trigger). Idempotent + guarded.
    await applyFtsSetup(TEST_DATABASE_URL);

    // ── Admin user ────────────────────────────────────────────────────────
    await createUserWithRole(prisma, {
      email: `admin${TEST_SUFFIX}`,
      password: TEST_PASSWORD,
      role: 'ADMIN',
      permissions: [
        'products:create',
        'products:update',
        'products:manage',
        'categories:create',
        'analytics:view',
        'inventory:manage',
      ],
      firstName: 'Search',
      lastName: 'Admin',
    });
    adminCookie = await loginAs(`admin${TEST_SUFFIX}`, TEST_PASSWORD);

    // ── Category ──────────────────────────────────────────────────────────
    const catRes = await api()
      .post('/v1/admin/categories')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'Footwear', en: 'Footwear' },
        slug: `search-footwear-${Date.now()}`,
      });
    categoryId = catRes.body.data?.id;

    // ── Products ──────────────────────────────────────────────────────────
    const ts = Date.now();

    shoesSku = `SHOES-SKU-${ts}`;
    const shoesRes = await api()
      .post('/v1/admin/products')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'Running Shoes', en: 'Running Shoes' },
        slug: `running-shoes-${ts}`,
        description: { default: 'Fast athletic running shoes' },
        tags: ['sport', 'shoes', 'running'],
        brand: 'Nike',
        status: 'ACTIVE',
        categoryIds: [categoryId],
        variants: [{ sku: shoesSku, price: 1847 }],
      });
    productShoesId = shoesRes.body.data?.id;

    const shirtRes = await api()
      .post('/v1/admin/products')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'Cotton Shirt', en: 'Cotton Shirt' },
        slug: `cotton-shirt-${ts}`,
        description: { default: 'Comfortable everyday cotton shirt' },
        tags: ['clothing', 'shirt', 'casual'],
        brand: 'H&M',
        status: 'ACTIVE',
        variants: [{ sku: `SHIRT-SKU-${ts}`, price: 35 }],
      });
    productShirtId = shirtRes.body.data?.id;

    // ── Subtree fixture: parent "Outdoor Gear" → child "Hiking Boots"; the
    //    product is filed ONLY under the child. Searching the PARENT name must
    //    still return it (recursive subtree match).
    const parentRes = await api()
      .post('/v1/admin/categories')
      .set('Cookie', adminCookie)
      .send({ name: { default: 'Outdoor Gear', en: 'Outdoor Gear' }, slug: `outdoor-gear-${ts}` });
    parentCategoryId = parentRes.body.data?.id;

    const childRes = await api()
      .post('/v1/admin/categories')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'Hiking Boots', en: 'Hiking Boots' },
        slug: `hiking-boots-${ts}`,
        parentId: parentCategoryId,
      });
    childCategoryId = childRes.body.data?.id;

    const bootRes = await api()
      .post('/v1/admin/products')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'Trailblazer 3000', en: 'Trailblazer 3000' },
        slug: `trailblazer-${ts}`,
        description: { default: 'Rugged waterproof boot' },
        tags: ['outdoor'],
        status: 'ACTIVE',
        categoryIds: [childCategoryId],
        variants: [{ sku: `BOOT-SKU-${ts}`, price: 420 }],
      });
    productBootId = bootRes.body.data?.id;

    // ── Null-tags regression fixture (the COALESCE trigger fix): a product
    //    whose tags become NULL must still get a NON-NULL searchVector and stay
    //    findable by name.
    const noTagsRes = await api()
      .post('/v1/admin/products')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'Zephyr Untagged', en: 'Zephyr Untagged' },
        slug: `zephyr-untagged-${ts}`,
        description: { default: 'A product with no tags' },
        status: 'ACTIVE',
        variants: [{ sku: `ZEPHYR-SKU-${ts}`, price: 99 }],
      });
    productNoTagsId = noTagsRes.body.data?.id;

    // ── French fixtures (D2) ──────────────────────────────────────
    // D2 moved search from the Postgres `arabic` text-search configuration to
    // `french` (search.service.ts + prisma/search_fts_setup.sql) and made the
    // French ILIKE branches unaccent-symmetric. Every fixture above is
    // English-only, so none of that was exercised. Each fixture below is tuned
    // so the ONLY route that can return it is the one under test:
    //
    //   * the queried word lives only in `name.fr`, never in `default` / `en`,
    //     so the `english` segment of the tsvector cannot answer;
    //   * the French wording and the query stem to the same lexeme under
    //     `french` but to different lexemes under `english`, or differ only by
    //     an accent, so `plainto_tsquery('french', unaccent(q))` is the only
    //     tsquery that can match;
    //   * every `name` string is long enough that its trigram similarity to the
    //     query stays under TRGM_THRESHOLD (0.15), so the `similarity()` rungs
    //     of the match condition cannot rescue a broken configuration.

    // (a) Accent symmetry. `électrique` and `electrique` both stem to `electr`
    //     ONLY once unaccent() is applied on both sides. The raw accented form
    //     stems to `électr`, which never matches the unaccented vector.
    const frAccentRes = await api()
      .post('/v1/admin/products')
      .set('Cookie', adminCookie)
      .send({
        name: {
          default: 'Modele Gamma Cabinet',
          fr: 'Brosse à cheveux électrique rechargeable sans fil avec minuteur intégré et voyage',
          en: 'Gamma cabinet model',
        },
        slug: `fr-accent-${ts}`,
        status: 'ACTIVE',
        variants: [{ sku: `FRACCENT-SKU-${ts}`, price: 61 }],
      });
    if (frenchEnabled) expect(frAccentRes.status).toBe(201);
    productFrAccentId = frAccentRes.body.data?.id;

    // (b) Ranking pair for the multi-word query "blanchiment des ongles".
    //     `blanchiment` and `blanchissant` both stem to `blanch` under `french`
    //     but to `blanchiment` / `blanchiss` under `english`, so only the French
    //     segment of the rank product's vector can match the query.
    const frRankRes = await api()
      .post('/v1/admin/products')
      .set('Cookie', adminCookie)
      .send({
        name: {
          default: 'Sourire Eclat Premium',
          fr: 'Vernis blanchissant pour les ongles sensibles',
          en: 'Premium smile fixture',
        },
        slug: `fr-rank-${ts}`,
        status: 'ACTIVE',
        variants: [{ sku: `FRRANK-SKU-${ts}`, price: 62 }],
      });
    if (frenchEnabled) expect(frRankRes.status).toBe(201);
    productFrRankId = frRankRes.body.data?.id;

    //     The decoy carries no `fr` key at all, so it can only be returned by
    //     the trigram rung, and its trigram similarity to the query (0.74) is
    //     far higher than the rank product's (0.32). It therefore OUT-RANKS the
    //     rank product unless the `french` ts_rank_cd term contributes.
    const frDecoyRes = await api()
      .post('/v1/admin/products')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'Blanchiment Ongles Kit', en: 'Whitening kit fixture' },
        slug: `fr-decoy-${ts}`,
        status: 'ACTIVE',
        variants: [{ sku: `FRDECOY-SKU-${ts}`, price: 63 }],
      });
    if (frenchEnabled) expect(frDecoyRes.status).toBe(201);
    productFrDecoyId = frDecoyRes.body.data?.id;

    // (c) Accented CATEGORY name -> resolveCategoryMatches ILIKE branch. The
    //     product itself carries none of the queried word, so the only way it
    //     can surface for `specialisee` is through its category.
    const frCatRes = await api()
      .post('/v1/admin/categories')
      .set('Cookie', adminCookie)
      .send({
        name: {
          default: 'Hygiène Bucco-Dentaire Spécialisée en Cabinet Professionnel',
          fr: 'Hygiène Bucco-Dentaire Spécialisée en Cabinet Professionnel',
          en: 'Specialised Oral Hygiene in Professional Practice',
        },
        slug: `fr-hygiene-specialisee-${ts}`,
      });
    frCategoryId = frCatRes.body.data?.id;

    const frCatProductRes = await api()
      .post('/v1/admin/products')
      .set('Cookie', adminCookie)
      .send({
        name: {
          default: 'Kit Cabinet Numero Sept',
          fr: 'Kit de cabinet numéro sept',
          en: 'Cabinet kit seven',
        },
        slug: `fr-cat-product-${ts}`,
        status: 'ACTIVE',
        categoryIds: [frCategoryId],
        variants: [{ sku: `FRCAT-SKU-${ts}`, price: 64 }],
      });
    if (frenchEnabled) expect(frCatProductRes.status).toBe(201);
    productFrCategoryId = frCatProductRes.body.data?.id;

    // (d) Accented BRAND name -> resolveBrandMatches ILIKE branch. Brand has no
    //     admin CRUD route, so the row is seeded directly and linked by id.
    const frBrand = await prisma.brand.create({
      data: {
        name: {
          default: 'Laboratoire Dentaire Éclatance Précision Professionnelle de Tripoli',
          fr: 'Laboratoire Dentaire Éclatance Précision Professionnelle de Tripoli',
          en: 'Eclatance Precision Professional Dental Lab of Tripoli',
        },
        slug: `fr-eclatance-${ts}`,
      },
    });
    frBrandId = frBrand.id;

    const frBrandProductRes = await api()
      .post('/v1/admin/products')
      .set('Cookie', adminCookie)
      .send({
        name: {
          default: 'Modele Delta Cabinet',
          fr: 'Coffret de cabinet modèle delta',
          en: 'Delta cabinet model',
        },
        slug: `fr-brand-product-${ts}`,
        status: 'ACTIVE',
        variants: [{ sku: `FRBRAND-SKU-${ts}`, price: 65 }],
      });
    if (frenchEnabled) expect(frBrandProductRes.status).toBe(201);
    productFrBrandId = frBrandProductRes.body.data?.id;

    await prisma.$executeRaw(
      Prisma.sql`UPDATE "Product" SET "brandId" = ${frBrandId} WHERE id = ${productFrBrandId}`,
    );

    // Arabic definite article. `الكتاب` and `كتاب` reduce to the same lexeme under
    // the `arabic` configuration (it strips the leading `ال`) but not under
    // `simple`, so only the `arabic` tsquery can return this product. The name
    // is long so trigram similarity to the query stays under TRGM_THRESHOLD.
    const arArticleRes = await api()
      .post('/v1/admin/products')
      .set('Cookie', adminCookie)
      .send({
        name: {
          default: 'Modele Sigma Cabinet',
          ar: 'الكتاب الإلكتروني الجديد القابل لإعادة الشحن مع مؤقت مدمج وحقيبة سفر',
          en: 'Sigma cabinet model',
        },
        slug: `ar-article-${ts}`,
        status: 'ACTIVE',
        variants: [{ sku: `ARARTICLE-SKU-${ts}`, price: 71 }],
      });
    if (arabicEnabled) expect(arArticleRes.status).toBe(201);
    productArArticleId = arArticleRes.body.data?.id;

    // Ensure the created products are active + published so the storefront
    // search surfaces them (searchVector is populated by the insert trigger).
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "Product" SET status = 'ACTIVE', "publishedAt" = NOW()
      WHERE id IN (
        ${productShoesId}, ${productShirtId}, ${productBootId}, ${productNoTagsId},
        ${productFrAccentId}, ${productFrRankId}, ${productFrDecoyId},
        ${productFrCategoryId}, ${productFrBrandId}, ${productArArticleId}
      )
    `);

    // Force tags = NULL on the regression fixture, then re-fire the trigger via
    // a name touch — reproduces the exact shape that left 51 products NULL.
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "Product" SET tags = NULL WHERE id = ${productNoTagsId}`,
    );
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "Product" SET name = name WHERE id = ${productNoTagsId}`,
    );
  });

  afterAll(async () => {
    await prisma.searchEvent.deleteMany({ where: { query: { contains: 'shoes' } } });
    await prisma.searchSynonym.deleteMany({ where: { terms: { has: 'sneakers' } } });
    await prisma.merchandisingRule.deleteMany({ where: { query: { contains: 'shoes' } } });
    // The Brand row is seeded directly (no admin CRUD route) and `slug` is
    // UNIQUE, so it must go or the next run collides. Guarded on the id: a
    // beforeAll that died early would leave it undefined, and an unfiltered
    // deleteMany would take the whole Brand table with it.
    if (frBrandId) {
      await prisma.$executeRaw(
        Prisma.sql`UPDATE "Product" SET "brandId" = NULL WHERE "brandId" = ${frBrandId}`,
      );
      await prisma.brand.deleteMany({ where: { id: frBrandId } });
    }
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    await prisma.$disconnect();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Suite 1 — Product search and ranking
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Product search and ranking', () => {
    it('GET /v1/search — returns all active products for empty query', async () => {
      const res = await api().get('/v1/search').expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20 });
    });

    it('GET /v1/search?q=shoes — returns shoes product via FTS or trigram', async () => {
      const res = await api().get('/v1/search?q=shoes').expect(200);

      // Per S7 contract (storefront-api-reference.md §Search), each hit is
      // wrapped: { product: ProductSearchResult, eventId?, score? }.
      const ids = (res.body.data as Array<{ product: { id: string } }>).map((h) => h.product.id);
      expect(ids).toContain(productShoesId);
    });

    it('GET /v1/search?q=shoes — shoes product ranks above shirt', async () => {
      const res = await api().get('/v1/search?q=shoes').expect(200);

      const ids = (res.body.data as Array<{ product: { id: string } }>).map((h) => h.product.id);
      const shoesIdx = ids.indexOf(productShoesId);
      const shirtIdx = ids.indexOf(productShirtId);
      // Shirt may not appear, but if both appear, shoes must rank higher
      if (shirtIdx !== -1) {
        expect(shoesIdx).toBeLessThan(shirtIdx);
      }
    });

    it('GET /v1/search?brand=Nike — filters by brand', async () => {
      const res = await api().get('/v1/search?brand=Nike').expect(200);

      const ids = (res.body.data as Array<{ product: { id: string } }>).map((h) => h.product.id);
      expect(ids).toContain(productShoesId);
      expect(ids).not.toContain(productShirtId);
    });

    it('GET /v1/search?categoryId=... — filters by category', async () => {
      const res = await api().get(`/v1/search?categoryId=${categoryId}`).expect(200);

      const ids = (res.body.data as Array<{ product: { id: string } }>).map((h) => h.product.id);
      expect(ids).toContain(productShoesId);
    });

    it('GET /v1/search/filters — returns FilterBucket array shape', async () => {
      // Facets moved from `/v1/search`'s response body to a dedicated
      // `/v1/search/filters` endpoint per S7 (storefront-api-reference.md
      // §Search). The new contract is a flat array of
      // `{ facet, values: Array<{ value, count }> }` so the storefront's
      // FilterRailComponent can iterate uniformly.
      const res = await api().get('/v1/search/filters').expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      const facets = (res.body.data as Array<{ facet: string }>).map((b) => b.facet);
      expect(facets).toEqual(expect.arrayContaining(['brand', 'category']));
      // Each bucket carries a `values` array of `{ value, count }` rows.
      const brandBucket = (
        res.body.data as Array<{
          facet: string;
          values: Array<{ value: string; count: number }>;
        }>
      ).find((b) => b.facet === 'brand');
      if (brandBucket) {
        expect(brandBucket.values).toBeInstanceOf(Array);
        if (brandBucket.values.length > 0) {
          expect(brandBucket.values[0]).toMatchObject({
            value: expect.any(String),
            count: expect.any(Number),
          });
        }
      }
    });

    it('GET /v1/search — pagination works', async () => {
      const res = await api().get('/v1/search?page=1&pageSize=1').expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.pageSize).toBe(1);
    });

    it('GET /v1/search?priceMin=1840&priceMax=1855 — price filter keeps shoes, excludes shirt', async () => {
      // A tight band around the shoes' distinctive price (1847) — the shirt
      // (price 35) falls outside it, and no seeded product sits in the band,
      // so the result is deterministic regardless of catalogue size.
      const res = await api().get('/v1/search?priceMin=1840&priceMax=1855').expect(200);

      const ids = (res.body.data as Array<{ product: { id: string } }>).map((h) => h.product.id);
      expect(ids).toContain(productShoesId);
      expect(ids).not.toContain(productShirtId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Suite 1b — Coverage: a keyword finds a product by EVERY field
  //            (storefront-search-restore §2.2 + §4)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Coverage — keyword finds product by every field', () => {
    const hitIds = (res: { body: { data: Array<{ product: { id: string } }> } }): string[] =>
      res.body.data.map((h) => h.product.id);

    it('by DESCRIPTION word — q=athletic finds Running Shoes', async () => {
      const res = await api().get('/v1/search?q=athletic').expect(200);
      expect(hitIds(res)).toContain(productShoesId);
    });

    it('by TAG — q=casual finds Cotton Shirt', async () => {
      const res = await api().get('/v1/search?q=casual').expect(200);
      expect(hitIds(res)).toContain(productShirtId);
    });

    it('by BRAND keyword (q, not the filter) — q=Nike finds Running Shoes', async () => {
      const res = await api().get('/v1/search?q=Nike').expect(200);
      expect(hitIds(res)).toContain(productShoesId);
      expect(hitIds(res)).not.toContain(productShirtId);
    });

    it('by CATEGORY name — q=Footwear finds the categorised product', async () => {
      const res = await api().get('/v1/search?q=Footwear').expect(200);
      expect(hitIds(res)).toContain(productShoesId);
    });

    it('by SUBCATEGORY parent name (subtree) — q="Outdoor Gear" finds a boot filed under the child', async () => {
      const res = await api()
        .get(`/v1/search?q=${encodeURIComponent('Outdoor Gear')}`)
        .expect(200);
      expect(hitIds(res)).toContain(productBootId);
    });

    it('by REFERENCE / SKU — exact sku finds the product', async () => {
      const res = await api()
        .get(`/v1/search?q=${encodeURIComponent(shoesSku)}`)
        .expect(200);
      expect(hitIds(res)).toContain(productShoesId);
    });

    it('null-tags regression — product keeps a NON-NULL searchVector and is findable', async () => {
      const row = await prisma.$queryRaw<Array<{ is_null: boolean }>>(
        Prisma.sql`SELECT ("searchVector" IS NULL) AS is_null FROM "Product" WHERE id = ${productNoTagsId}`,
      );
      expect(row[0]?.is_null).toBe(false);
      const res = await api().get('/v1/search?q=Zephyr').expect(200);
      expect(hitIds(res)).toContain(productNoTagsId);
    });

    it('no false positives — a nonsense query returns zero hits', async () => {
      const res = await api().get('/v1/search?q=zzqqxxnomatch123').expect(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Suite 1c: French full-text search (D2)
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Pins the D2 move from the Postgres `arabic` text-search configuration to
  // `french`: the `french` segment of the trigger-built tsvector
  // (prisma/search_fts_setup.sql), the `french` term added to `rankExpr`, and
  // the unaccent-symmetric French ILIKE branches in `resolveCategoryMatches` /
  // `resolveBrandMatches`.
  //
  // A unit test cannot reach any of this: `search.service.spec.ts` mocks
  // `prisma.$queryRaw` as a bare `jest.fn()`, so the text-search configuration
  // string is never executed. Only a query against the real dockerised
  // Postgres, with the real trigger applied, can tell `french` from `arabic`.

  describe('Arabic full-text search (LG6)', () => {
    if (!arabicEnabled) {
      it('refuses Arabic catalogue copy on a store that does not ship ar (400)', async () => {
        const ts = Date.now();
        const res = await api()
          .post('/v1/admin/products')
          .set('Cookie', adminCookie)
          .send({
            name: { default: 'No Arabic here', ar: 'لا عربية هنا' },
            slug: `ar-refused-${ts}`,
            status: 'ACTIVE',
            variants: [{ sku: `ARREFUSED-SKU-${ts}`, price: 1 }],
          });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });
      return;
    }

    it('the bare stem finds a product whose name carries the definite article', async () => {
      const res = await api()
        .get(`/v1/search?q=${encodeURIComponent('كتاب')}&pageSize=100`)
        .expect(200);
      const ids = (res.body.data as Array<{ product: { id: string } }>).map((h) => h.product.id);
      expect(ids).toContain(productArArticleId);
    });
  });

  describe('French full-text search (D2)', () => {
    // On a store without `fr` the French fixtures above were refused, so the
    // one fact to pin is that refusal.
    if (!frenchEnabled) {
      it('refuses French catalogue copy on a store that does not ship fr (400)', async () => {
        const ts = Date.now();
        const res = await api()
          .post('/v1/admin/products')
          .set('Cookie', adminCookie)
          .send({
            name: { default: 'No French here', fr: 'Pas de français ici' },
            slug: `fr-refused-${ts}`,
            status: 'ACTIVE',
            variants: [{ sku: `FRREFUSED-SKU-${ts}`, price: 1 }],
          });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });
      return;
    }

    const hitIds = (res: { body: { data: Array<{ product: { id: string } }> } }): string[] =>
      res.body.data.map((h) => h.product.id);

    const search = (q: string) =>
      api()
        .get(`/v1/search?q=${encodeURIComponent(q)}&pageSize=100`)
        .expect(200);

    it('accent symmetry: the UNACCENTED query finds the accented French name', async () => {
      // The fixture name lives only in `name.fr`; its `default` / `en` keys
      // carry none of `electrique`, and both trigram similarities sit under
      // TRGM_THRESHOLD. The only rung that can return it is
      // `searchVector @@ plainto_tsquery('french', unaccent(q))`.
      const res = await search('electrique');
      expect(hitIds(res)).toContain(productFrAccentId);
    });

    it('accent symmetry: the ACCENTED query finds the same product', async () => {
      // The other direction is the one that pins unaccent() on the QUERY side:
      // the trigger stores `electr` (it unaccents before stemming), while a raw
      // `plainto_tsquery('french', 'électrique')` yields `électr` and matches
      // nothing. Dropping unaccent from either side breaks exactly this case.
      const res = await search('électrique');
      expect(hitIds(res)).toContain(productFrAccentId);
    });

    it('French multi-word query ranks the exact French match above the decoy', async () => {
      // `blanchiment` (query) and `blanchissant` (fixture) both stem to `blanch`
      // under `french`, but to `blanchiment` / `blanchiss` under `english`, so
      // the rank product is reachable only through the French tsquery.
      //
      // The decoy is reachable only through the trigram rung, and its trigram
      // similarity to the query (0.74) is more than double the rank product's
      // (0.32). Order therefore inverts the moment the `french` ts_rank_cd term
      // stops contributing: an assertion that merely checked "the rank product
      // is returned" would still pass with the rank term deleted.
      const res = await search('blanchiment des ongles');
      const ids = hitIds(res);

      const rankIdx = ids.indexOf(productFrRankId);
      const decoyIdx = ids.indexOf(productFrDecoyId);
      expect(rankIdx).toBeGreaterThanOrEqual(0);
      expect(decoyIdx).toBeGreaterThanOrEqual(0);
      expect(rankIdx).toBeLessThan(decoyIdx);
    });

    it('accented CATEGORY name is matched by its unaccented query', async () => {
      // Exercises the `unaccent(name->>'fr') ILIKE '%' || unaccent(term) || '%'`
      // branch of resolveCategoryMatches. The product carries none of
      // `specialisee` itself, and the category's trigram similarity to the query
      // (0.09) is under TRGM_THRESHOLD, so the unaccented ILIKE is the only way
      // this hit can happen.
      const res = await search('specialisee');
      expect(hitIds(res)).toContain(productFrCategoryId);
    });

    it('accented BRAND name is matched by its unaccented query', async () => {
      // Same branch in resolveBrandMatches. Brand similarity to the query is
      // 0.12, under TRGM_THRESHOLD, and the product name shares nothing with
      // `eclatance`.
      const res = await search('eclatance');
      expect(hitIds(res)).toContain(productFrBrandId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Suite 1d: copy written in the store's default locale only
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // The query side probes `name->>{store default locale}` (plan E1.3) and the
  // trigger builds a tsvector segment plus a trigram index per catalogue
  // locale. Under the gulf-rtl fixture this block runs in Arabic through the
  // `simple` segment; under demo and maghreb-ltr in English or French. A unit
  // test cannot reach the SQL, so the live path is pinned here for whichever
  // locale the fixture makes the default.

  describe('Store default locale copy', () => {
    const TERMS: Record<string, { name: string; word: string; prefix: string }> = {
      // Short names: suggest ranks by trigram similarity against the whole
      // name, so a long name would sink a legitimate prefix under the threshold.
      ar: { name: 'مكنسة لاسلكية', word: 'مكنسة', prefix: 'مكنسة' },
      fr: { name: 'Bouilloire zephyrion', word: 'zephyrion', prefix: 'zephyrion' },
      en: { name: 'Zephyrion kettle', word: 'zephyrion', prefix: 'zephyrion' },
    };
    const term = TERMS[STORE_DEFAULT_LOCALE] ?? TERMS['en'];
    let localeOnlyId: string;
    let localeOnlySlug: string;

    beforeAll(async () => {
      localeOnlySlug = `locale-only-${Date.now()}`;
      const res = await api()
        .post('/v1/admin/products')
        .set('Cookie', adminCookie)
        .send({
          // `default` carries a filler that shares nothing with the query, so
          // only the locale key's tsvector segment and trigram index can answer.
          name: { default: 'Locale only fixture', [STORE_DEFAULT_LOCALE]: term.name },
          slug: localeOnlySlug,
          status: 'ACTIVE',
          variants: [{ sku: `LOCALEONLY-SKU-${Date.now()}`, price: 12 }],
        });
      expect(res.status).toBe(201);
      localeOnlyId = res.body.data.id;
    });

    afterAll(async () => {
      if (localeOnlyId) {
        await prisma.productVariant.deleteMany({ where: { productId: localeOnlyId } });
        await prisma.product.deleteMany({ where: { id: localeOnlyId } });
      }
    });

    it('full-text search finds a product named only in the store default locale', async () => {
      const res = await api()
        .get(`/v1/search?q=${encodeURIComponent(term.word)}&pageSize=100`)
        .expect(200);
      const ids = res.body.data.map((h: { product: { id: string } }) => h.product.id);
      expect(ids).toContain(localeOnlyId);
    });

    it('suggest finds it by a prefix under the store default locale', async () => {
      const res = await api()
        .get(`/v1/search/suggest?q=${encodeURIComponent(term.prefix)}`)
        .set('Accept-Language', STORE_DEFAULT_LOCALE)
        .expect(200);
      expect(JSON.stringify(res.body.data)).toContain(localeOnlySlug);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Suite 2 — Synonym expansion
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Synonym expansion', () => {
    it('POST /v1/admin/search/synonyms — creates synonym group', async () => {
      const res = await api()
        .post('/v1/admin/search/synonyms')
        .set('Cookie', adminCookie)
        .send({ terms: ['sneakers', 'trainers', 'running shoes'] })
        .expect(201);

      expect(res.body.data).toMatchObject({
        id: expect.any(String),
        terms: expect.arrayContaining(['sneakers', 'trainers', 'running shoes']),
        isActive: true,
      });
    });

    it('GET /v1/search?q=sneakers — synonym expands to find Running Shoes product', async () => {
      const res = await api().get('/v1/search?q=sneakers').expect(200);

      // synonym "sneakers" → expands to include "running shoes" → matches product
      const ids = (res.body.data as Array<{ product: { id: string } }>).map((h) => h.product.id);
      expect(ids).toContain(productShoesId);
    });

    it('GET /v1/admin/search/synonyms — lists synonyms', async () => {
      const res = await api()
        .get('/v1/admin/search/synonyms')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20 });
    });

    it('DELETE /v1/admin/search/synonyms/:id — deletes synonym', async () => {
      // Create a disposable synonym
      const createRes = await api()
        .post('/v1/admin/search/synonyms')
        .set('Cookie', adminCookie)
        .send({ terms: ['temp', 'temporary'] })
        .expect(201);

      const id = createRes.body.data?.id as string;

      await api().delete(`/v1/admin/search/synonyms/${id}`).set('Cookie', adminCookie).expect(204);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Suite 3 — Merchandising rules
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Merchandising rules', () => {
    it('POST /v1/admin/search/merchandising — creates BOOST rule', async () => {
      const res = await api()
        .post('/v1/admin/search/merchandising')
        .set('Cookie', adminCookie)
        .send({
          type: 'BOOST',
          query: 'shoes',
          productId: productShoesId,
          priority: 10,
        })
        .expect(201);

      expect(res.body.data).toMatchObject({
        id: expect.any(String),
        type: 'BOOST',
        productId: productShoesId,
      });
    });

    it('POST /v1/admin/search/merchandising — creates PIN rule with position', async () => {
      const res = await api()
        .post('/v1/admin/search/merchandising')
        .set('Cookie', adminCookie)
        .send({
          type: 'PIN',
          query: 'shoes',
          productId: productShoesId,
          position: 0,
        })
        .expect(201);

      expect(res.body.data).toMatchObject({ type: 'PIN', position: 0 });
    });

    it('POST /v1/admin/search/merchandising — PIN without position returns 400', async () => {
      await api()
        .post('/v1/admin/search/merchandising')
        .set('Cookie', adminCookie)
        .send({ type: 'PIN', productId: productShoesId })
        .expect(400);
    });

    it('POST /v1/admin/search/merchandising — BOOST without productId returns 400', async () => {
      await api()
        .post('/v1/admin/search/merchandising')
        .set('Cookie', adminCookie)
        .send({ type: 'BOOST', query: 'shoes' })
        .expect(400);
    });

    it('GET /v1/admin/search/merchandising — lists rules with pagination', async () => {
      const res = await api()
        .get('/v1/admin/search/merchandising')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.meta).toMatchObject({ page: 1 });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Suite 4 — Suggest / autocomplete
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Suggest (autocomplete)', () => {
    it('GET /v1/search/suggest?q=run — returns product suggestions', async () => {
      const res = await api().get('/v1/search/suggest?q=run').expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeLessThanOrEqual(8);
    });

    it('GET /v1/search/suggest?q=shoe — returns up to 8 items', async () => {
      const res = await api().get('/v1/search/suggest?q=shoe').expect(200);

      expect(res.body.data.length).toBeLessThanOrEqual(8);
      if (res.body.data.length > 0) {
        expect(res.body.data[0]).toMatchObject({
          type: expect.stringMatching(/^(product|category)$/),
          label: expect.any(String),
          slug: expect.any(String),
        });
      }
    });

    it('GET /v1/search/suggest — missing q returns 400', async () => {
      await api().get('/v1/search/suggest').expect(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Suite 5 — Analytics
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Analytics', () => {
    it('GET /v1/admin/search/analytics — returns top queries, zero results, conversion rate', async () => {
      // Trigger a search to create events
      await api().get('/v1/search?q=shoes').expect(200);
      await api().get('/v1/search?q=noresult_xyz_abc').expect(200);

      const res = await api()
        .get('/v1/admin/search/analytics?period=30')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.data).toMatchObject({
        topQueries: expect.any(Array),
        zeroResultQueries: expect.any(Array),
        conversionRate: expect.any(Number),
        totalSearches: expect.any(Number),
        period: 30,
      });
    });

    it('POST /v1/admin/search/reindex — triggers reindex', async () => {
      const res = await api()
        .post('/v1/admin/search/reindex')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.data).toMatchObject({
        message: expect.stringContaining('Reindex'),
        reindexed: expect.any(Number),
      });
    });

    it('GET /v1/admin/search/analytics — requires analytics:view permission', async () => {
      await api().get('/v1/admin/search/analytics').expect(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Suite 6 — Search event lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Search event lifecycle', () => {
    let eventId: string;

    it('search creates a SearchEvent record', async () => {
      await api().get('/v1/search?q=shoes').expect(200);

      const event = await prisma.searchEvent.findFirst({
        where: { query: 'shoes' },
        orderBy: { createdAt: 'desc' },
      });
      expect(event).toBeTruthy();
      expect(event?.resultCount).toBeGreaterThanOrEqual(0);
      eventId = event!.id;
    });

    it('POST /v1/search/events/:id/click — records click data', async () => {
      await api()
        .post(`/v1/search/events/${eventId}/click`)
        .send({ clickedProductId: productShoesId, clickPosition: 0 })
        .expect(204);

      const updated = await prisma.searchEvent.findUnique({ where: { id: eventId } });
      expect(updated?.clickedProductId).toBe(productShoesId);
      expect(updated?.clickPosition).toBe(0);
    });

    it('POST /v1/search/events/:id/convert — marks conversion', async () => {
      await api().post(`/v1/search/events/${eventId}/convert`).expect(204);

      const updated = await prisma.searchEvent.findUnique({ where: { id: eventId } });
      expect(updated?.convertedToOrder).toBe(true);
    });

    it('POST /v1/search/events/invalid/click — returns 404', async () => {
      await api()
        .post('/v1/search/events/nonexistent-id/click')
        .send({ clickedProductId: productShoesId, clickPosition: 0 })
        .expect(404);
    });
  });
});
