/**
 * i18n E2E
 *
 * Admin creates a product with a Translatable name keyed by the store's own
 * enabled locale pair, then:
 * GET /products/:slug (Accept-Language: <secondary>) resolves the secondary string
 * GET /products/:slug (Accept-Language: <default>) resolves the default string
 * GET /admin/products/:id (X-Resolve-Locale: false) returns the full Translatable
 *
 * Only the store's two enabled locales can be submitted (IsEnabledLocale, plan
 * E1.3.4), so the payload cannot hardcode fr/en — gulf-rtl ships ar/en and
 * would 400 a submitted 'fr' key.
 *
 * The `default` key deliberately carries the SECONDARY locale's value, not the
 * default locale's: that is the only shape in which an unsupported-locale
 * request can be told apart from a default-locale fallback.
 */
import { PrismaClient } from '@prisma/client';
import {
  api,
  createTestPrisma,
  loginAs,
  ADMIN,
  STORE_DEFAULT_LOCALE,
  STORE_SECONDARY_LOCALE,
} from './helpers';

const PRODUCT_SLUG = `i18n-test-${Date.now()}`;
const SECONDARY_NAME = 'Bilingual Test Jacket (secondary)';
const DEFAULT_NAME = 'Bilingual Test Jacket (default)';

describe('i18n (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  let productId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    // Resolve a product type
    const typesRes = await api()
      .get('/v1/admin/product-types')
      .set('Cookie', adminCookie)
      .expect(200);
    const productTypeId = typesRes.body.data[0].id;

    // Create product with a bilingual name keyed by the store's own locales
    const res = await api()
      .post('/v1/admin/products')
      .set('Cookie', adminCookie)
      .send({
        name: {
          default: SECONDARY_NAME,
          [STORE_SECONDARY_LOCALE]: SECONDARY_NAME,
          [STORE_DEFAULT_LOCALE]: DEFAULT_NAME,
        },
        slug: PRODUCT_SLUG,
        description: {
          default: 'A'.repeat(60),
          [STORE_SECONDARY_LOCALE]: 'A'.repeat(60),
          [STORE_DEFAULT_LOCALE]: 'B'.repeat(60),
        },
        shortDescription: {
          default: 'Secondary jacket.',
          [STORE_SECONDARY_LOCALE]: 'Secondary jacket.',
          [STORE_DEFAULT_LOCALE]: 'Default jacket.',
        },
        productTypeId,
        status: 'ACTIVE',
        isFeatured: false,
      })
      .expect(201);

    productId = res.body.data.id;
    expect(productId).toBeDefined();
  });

  afterAll(async () => {
    try {
      if (productId) {
        await api().delete(`/v1/admin/products/${productId}`).set('Cookie', adminCookie);
      }
    } catch {
      // ignore
    }
    await prisma.$disconnect();
  });

  // ── Secondary-locale resolution ──────────────────────────────────────────────

  it('GET /v1/products/:slug (Accept-Language: secondary) resolves the secondary-locale string', async () => {
    const res = await api()
      .get(`/v1/products/${PRODUCT_SLUG}`)
      .set('Accept-Language', STORE_SECONDARY_LOCALE)
      .expect(200);

    expect(typeof res.body.data.name).toBe('string');
    expect(res.body.data.name).toBe(SECONDARY_NAME);
  });

  // ── Default-locale resolution ────────────────────────────────────────────────

  it('GET /v1/products/:slug (Accept-Language: default) — name is the default-locale string', async () => {
    const res = await api()
      .get(`/v1/products/${PRODUCT_SLUG}`)
      .set('Accept-Language', STORE_DEFAULT_LOCALE)
      .expect(200);

    expect(typeof res.body.data.name).toBe('string');
    expect(res.body.data.name).toBe(DEFAULT_NAME);
  });

  it('GET /v1/products/:slug (no locale header) — falls back to default', async () => {
    const res = await api().get(`/v1/products/${PRODUCT_SLUG}`).expect(200);

    expect(typeof res.body.data.name).toBe('string');
    // No header parses to the 'default' sentinel, which the first rung of the
    // chain already satisfies. `default` carries SECONDARY_NAME, not DEFAULT_NAME.
    expect(res.body.data.name).toBe(SECONDARY_NAME);
  });

  // ── Admin raw Translatable object ────────────────────────────────────────────

  it('GET /v1/admin/products/:id (X-Resolve-Locale: false) — returns full Translatable object', async () => {
    const res = await api()
      .get(`/v1/admin/products/${productId}`)
      .set('Cookie', adminCookie)
      .set('X-Resolve-Locale', 'false')
      .expect(200);

    const name = res.body.data.name;
    expect(typeof name).toBe('object');
    expect(name.default).toBe(SECONDARY_NAME);
    expect(name[STORE_SECONDARY_LOCALE]).toBe(SECONDARY_NAME);
    expect(name[STORE_DEFAULT_LOCALE]).toBe(DEFAULT_NAME);
  });

  it('GET /v1/admin/products/:id (no header) — admin also resolves to default locale string', async () => {
    const res = await api()
      .get(`/v1/admin/products/${productId}`)
      .set('Cookie', adminCookie)
      .expect(200);

    // Without X-Resolve-Locale: false, the interceptor resolves it to a string
    expect(typeof res.body.data.name).toBe('string');
  });

  // ── Unsupported locale falls back to the store default rung ──────────────────

  it('GET /v1/products/:slug (Accept-Language: de) falls through to the store default rung', async () => {
    const res = await api()
      .get(`/v1/products/${PRODUCT_SLUG}`)
      .set('Accept-Language', 'de')
      .expect(200);

    // 'de' is outside the enabled set. The resolver's chain is the requested
    // locale, then the store default locale, then 'default', and an
    // unsupported locale must still traverse all three (DR-31). SECONDARY_NAME
    // and DEFAULT_NAME differ, so this fails if the parser ever short-circuits
    // the first rung onto 'default' instead of the store's default locale.
    expect(typeof res.body.data.name).toBe('string');
    expect(res.body.data.name).toBe(DEFAULT_NAME);
  });
});
