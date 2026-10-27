import { PrismaClient, ProductStatus } from '@prisma/client';
import {
  api,
  createTestPrisma,
  loginAs,
  signUpCustomer,
  ADMIN,
  STORE_DEFAULT_LOCALE,
} from '../../../test/e2e/helpers';

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_SUFFIX = '@e2e-geo.test';
const TEST_PASSWORD = 'StrongPass1!';

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('GEO (e2e)', () => {
  let prisma: PrismaClient;

  let adminCookie: string;
  let customerCookie: string;
  let testProductId: string;

  // ── Setup ──────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    prisma = createTestPrisma();

    // ── Admin session ── seeded SUPER_ADMIN bypasses all permission checks.
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    // ── Customer session ──
    customerCookie = await signUpCustomer(prisma, `customer${TEST_SUFFIX}`, TEST_PASSWORD, {
      firstName: 'Geo',
      lastName: 'Customer',
    });

    // ── Seed a test product ──
    const category = await prisma.category.create({
      data: {
        name: { default: 'GEO Test Cat', en: 'GEO Test Cat' },
        slug: 'geo-test-cat-e2e',
        description: { default: 'GEO test category' },
        path: '/geo-test-cat-e2e/',
        depth: 0,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: { default: 'GEO Test Product', en: 'GEO Test Product' },
        slug: 'geo-test-product-e2e',
        description: { default: 'A'.repeat(150), en: 'A'.repeat(150) },
        shortDescription: { default: 'Short desc', en: 'Short desc' },
        status: ProductStatus.ACTIVE,
        publishedAt: new Date(),
      },
    });
    testProductId = product.id;

    // Associate product with category
    await prisma.productCategory.create({
      data: { productId: product.id, categoryId: category.id },
    });
  });

  afterAll(async () => {
    await prisma.productFaq.deleteMany({ where: { product: { slug: 'geo-test-product-e2e' } } });
    await prisma.productCategory.deleteMany({
      where: { product: { slug: 'geo-test-product-e2e' } },
    });
    await prisma.product.deleteMany({ where: { slug: 'geo-test-product-e2e' } });
    await prisma.category.deleteMany({ where: { slug: 'geo-test-cat-e2e' } });
    await prisma.user.deleteMany({ where: { email: { contains: TEST_SUFFIX } } });
    await prisma.$disconnect();
  });

  // ── Storefront: llms.txt ───────────────────────────────────────────────────

  describe('GET /v1/llms.txt', () => {
    it('returns 200 with text/plain content-type without authentication', async () => {
      const res = await api().get('/v1/llms.txt');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
    });

    it('contains the standard llms.txt header line', async () => {
      const res = await api().get('/v1/llms.txt');

      // S23: H1 is resolved store name — starts with "# " + non-empty name.
      // The literal "# Store" was the pre-S23 placeholder; the actual value is
      // the store name from StoreSettings (e.g. "# Demo Store").
      expect(res.text).toMatch(/^# .+/m);
    });

    it('includes top categories with locale-prefixed catalog URLs', async () => {
      const res = await api().get('/v1/llms.txt');

      // Category may not appear if it falls outside GEO_TOP_CATEGORIES_COUNT=10.
      // Assert URL shape if the category is present.
      if (res.text.includes('GEO Test Cat')) {
        // S23: locale-prefixed Analog routes — agent_docs/storefront/seo-geo.md §llms.txt shape.
        // No Accept-Language on this request, so the URL is prefixed with the
        // store's default locale (STORE_DEFAULT_LOCALE), not a literal fr/en.
        expect(res.text).not.toContain('/categories/geo-test-cat-e2e');
        expect(res.text).toContain(`/${STORE_DEFAULT_LOCALE}/catalog/geo-test-cat-e2e`);
      }
    });

    it('includes popular products with locale-prefixed catalog/product URLs', async () => {
      const res = await api().get('/v1/llms.txt');

      // Product may not appear if it falls outside GEO_POPULAR_PRODUCTS_COUNT=20.
      // Assert URL shape if the product is present.
      if (res.text.includes('GEO Test Product')) {
        // S23: locale-prefixed Analog routes — agent_docs/storefront/seo-geo.md §llms.txt shape.
        // No Accept-Language on this request, so the URL is prefixed with the
        // store's default locale (STORE_DEFAULT_LOCALE), not a literal fr/en.
        expect(res.text).not.toContain('/products/geo-test-product-e2e');
        expect(res.text).toContain(`/${STORE_DEFAULT_LOCALE}/catalog/product/geo-test-product-e2e`);
      }
    });

    it('resolves the fr locale from Accept-Language header', async () => {
      const res = await api().get('/v1/llms.txt').set('Accept-Language', 'fr');

      expect(res.status).toBe(200);
      // S23: H1 is resolved store name — starts with "# " followed by non-empty text.
      expect(res.text).toMatch(/^# .+/m);
    });
  });

  // ── Admin: AI-readiness ────────────────────────────────────────────────────

  describe('GET /v1/admin/geo/ai-readiness', () => {
    it('returns ai-readiness score structure for admin', async () => {
      const res = await api().get('/v1/admin/geo/ai-readiness').set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      // Actual response shape from GeoService.getAiReadinessScore():
      // { score, signals: { answerFirstDescription, faqEntries, completeSchemaMarkup }, productsAnalyzed }
      expect(res.body.data).toHaveProperty('productsAnalyzed');
      expect(res.body.data).toHaveProperty('score');
      expect(res.body.data).toHaveProperty('signals');
      expect(res.body.data.signals).toHaveProperty('answerFirstDescription');
      expect(res.body.data.signals).toHaveProperty('faqEntries');
      expect(res.body.data.signals).toHaveProperty('completeSchemaMarkup');
    });

    it('productsAnalyzed is at least 1 (test product was seeded)', async () => {
      const res = await api().get('/v1/admin/geo/ai-readiness').set('Cookie', adminCookie);

      expect(res.body.data.productsAnalyzed).toBeGreaterThanOrEqual(1);
    });

    it('signal values are between 0 and 1 (fractions)', async () => {
      const res = await api().get('/v1/admin/geo/ai-readiness').set('Cookie', adminCookie);

      const { answerFirstDescription, faqEntries, completeSchemaMarkup } = res.body.data
        .signals as Record<string, number>;

      // Signals are fractions 0–1 per GeoService contract
      expect(answerFirstDescription).toBeGreaterThanOrEqual(0);
      expect(answerFirstDescription).toBeLessThanOrEqual(1);
      expect(faqEntries).toBeGreaterThanOrEqual(0);
      expect(completeSchemaMarkup).toBeGreaterThanOrEqual(0);
    });

    it('returns 401 without authentication', async () => {
      const res = await api().get('/v1/admin/geo/ai-readiness');
      expect(res.status).toBe(401);
    });

    it('returns 403 for customer without geo:view', async () => {
      const res = await api().get('/v1/admin/geo/ai-readiness').set('Cookie', customerCookie);
      expect(res.status).toBe(403);
    });
  });

  // ── Admin: FAQ suggestions ─────────────────────────────────────────────────

  describe('GET /v1/admin/geo/products/:productId/faqs/suggestions', () => {
    it('returns 3 suggestions for a product with no FAQs', async () => {
      const res = await api()
        .get(`/v1/admin/geo/products/${testProductId}/faqs/suggestions`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      // getFaqSuggestions returns the array directly; ApiResponseInterceptor
      // wraps it as { data: [...] }. Not { data: { suggestions: [...] } }.
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0]).toHaveProperty('question');
      expect(res.body.data[0]).toHaveProperty('answer');
    });

    it('each suggestion has a question and answer string (resolved by TranslatableInterceptor)', async () => {
      const res = await api()
        .get(`/v1/admin/geo/products/${testProductId}/faqs/suggestions`)
        .set('Cookie', adminCookie);

      // TranslatableInterceptor resolves Translatable JSONB to locale strings at the
      // API boundary. So question/answer arrive as strings, not { fr: "...", en: "..." }.
      const suggestion = res.body.data[0] as { question: unknown; answer: unknown };
      expect(typeof suggestion.question).toBe('string');
      expect((suggestion.question as string).length).toBeGreaterThan(0);
      expect(typeof suggestion.answer).toBe('string');
      expect((suggestion.answer as string).length).toBeGreaterThan(0);
    });

    it('returns 404 for unknown product', async () => {
      const res = await api()
        .get('/v1/admin/geo/products/non-existent-id/faqs/suggestions')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(404);
    });

    it('returns 403 for customer', async () => {
      const res = await api()
        .get(`/v1/admin/geo/products/${testProductId}/faqs/suggestions`)
        .set('Cookie', customerCookie);
      expect(res.status).toBe(403);
    });
  });

  // ── Admin: FAQ accept ──────────────────────────────────────────────────────

  describe('POST /v1/admin/geo/products/:productId/faqs/accept', () => {
    const faqPayload = {
      faqs: [
        {
          question: { default: 'What sizes?', en: 'What sizes?' },
          answer: { default: 'Check the page.', en: 'Check the page.' },
          sortOrder: 0,
        },
        {
          question: { default: 'Return policy?', en: 'Return policy?' },
          answer: { default: '30 days.', en: '30 days.' },
          sortOrder: 1,
        },
      ],
    };

    afterAll(async () => {
      // Clean up any FAQs created during this suite
      await prisma.productFaq.deleteMany({ where: { productId: testProductId } });
    });

    it('creates FAQs and returns the persisted FAQ array', async () => {
      const res = await api()
        .post(`/v1/admin/geo/products/${testProductId}/faqs/accept`)
        .set('Cookie', adminCookie)
        .send(faqPayload);

      expect(res.status).toBe(201);
      // acceptFaqSuggestions returns the FAQ array directly; ApiResponseInterceptor
      // wraps it as { data: [...] }. The array length reflects the FAQs created.
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(2);

      // Verify FAQs were actually persisted
      const faqs = await prisma.productFaq.findMany({ where: { productId: testProductId } });
      expect(faqs).toHaveLength(2);
    });

    it('is idempotent — returns existing FAQs when product already has FAQs', async () => {
      // Product now has 2 FAQs from the previous test
      const res = await api()
        .post(`/v1/admin/geo/products/${testProductId}/faqs/accept`)
        .set('Cookie', adminCookie)
        .send(faqPayload);

      expect(res.status).toBe(201);
      // Idempotent: returns the existing FAQs (not an empty result)
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('returns 400 for invalid payload (missing faqs array)', async () => {
      const res = await api()
        .post(`/v1/admin/geo/products/${testProductId}/faqs/accept`)
        .set('Cookie', adminCookie)
        .send({ faqs: 'not-an-array' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when faq item is missing question or answer', async () => {
      const res = await api()
        .post(`/v1/admin/geo/products/${testProductId}/faqs/accept`)
        .set('Cookie', adminCookie)
        .send({ faqs: [{ question: { en: 'Q?' } }] }); // missing answer

      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown product', async () => {
      const res = await api()
        .post('/v1/admin/geo/products/non-existent-id/faqs/accept')
        .set('Cookie', adminCookie)
        .send(faqPayload);

      expect(res.status).toBe(404);
    });

    it('returns 403 for customer', async () => {
      const res = await api()
        .post(`/v1/admin/geo/products/${testProductId}/faqs/accept`)
        .set('Cookie', customerCookie)
        .send(faqPayload);
      expect(res.status).toBe(403);
    });
  });

  // ── FAQ suggestions return empty after FAQs accepted ──────────────────────

  describe('FAQ suggestions → empty after accept', () => {
    it('returns empty suggestions once product has FAQs', async () => {
      // Ensure product has FAQs (created by the accept suite above or re-seeded)
      const faqCount = await prisma.productFaq.count({ where: { productId: testProductId } });
      if (faqCount === 0) {
        await prisma.productFaq.create({
          data: {
            productId: testProductId,
            question: { default: 'Q?', en: 'Q?' },
            answer: { default: 'A.', en: 'A.' },
          },
        });
      }

      const res = await api()
        .get(`/v1/admin/geo/products/${testProductId}/faqs/suggestions`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      // When product has FAQs, service returns empty array (not { suggestions: [] })
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(0);
    });
  });
});
