import { PrismaClient } from '@prisma/client';
import {
  api,
  createTestPrisma,
  createUserWithRole,
  loginAs,
  STORE_DEFAULT_LOCALE,
  STORE_SECONDARY_LOCALE,
} from '../../../test/e2e/helpers';

// ── Constants ────────────────────────────────────────────────────────────────

const TEST_SUFFIX = '@e2e-storefront-config.test';
const TEST_PASSWORD = 'StrongPass1!';
const PAGE_SLUG = `e2e-home-${Date.now()}`;

const HERO_ASSET_ID = '11111111-1111-4111-8111-111111111111';
const PROMO_ASSET_ID = '22222222-2222-4222-8222-222222222222';

const validHeroConfig = () => ({
  assetId: HERO_ASSET_ID,
  eyebrow: { default: 'Summer' },
  headline: { default: 'Sun and surf' },
  body: { default: 'Discover the new collection' },
  cta: { default: 'Shop now' },
  ctaHref: '/catalog',
});

const validPromotionalBannerConfig = () => ({
  assetId: PROMO_ASSET_ID,
  eyebrow: { default: 'Free delivery' },
  headline: { default: 'On orders over $50' },
  body: { default: 'No promo code required' },
});

// ── Suite ────────────────────────────────────────────────────────────────────

describe('StorefrontConfig (e2e)', () => {
  let prisma: PrismaClient;

  let adminCookie: string;
  let sectionId: string;

  // ── Setup ──────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    prisma = createTestPrisma();

    // Register an admin user carrying the storefront-config permission set.
    await createUserWithRole(prisma, {
      email: `admin${TEST_SUFFIX}`,
      password: TEST_PASSWORD,
      role: 'ADMIN',
      permissions: ['storefront_config:view', 'storefront_config:manage'],
      firstName: 'Storefront',
      lastName: 'Admin',
    });

    adminCookie = await loginAs(`admin${TEST_SUFFIX}`, TEST_PASSWORD);
  });

  afterAll(async () => {
    // Clean up test sections
    await prisma.storefrontSection.deleteMany({ where: { pageSlug: PAGE_SLUG } });
    await prisma.user.deleteMany({ where: { email: { contains: TEST_SUFFIX } } });
    await prisma.$disconnect();
  });

  // ── Admin: create section ──────────────────────────────────────────────────

  describe('POST /v1/admin/storefront/pages/:pageSlug/sections', () => {
    it('creates a HERO section with a typed per-type config', async () => {
      const res = await api()
        .post(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections`)
        .set('Cookie', adminCookie)
        .send({
          type: 'HERO',
          title: { default: 'Vente estivale', en: 'Summer Sale' },
          config: validHeroConfig(),
          sortOrder: 0,
          isVisible: true,
        })
        .expect(201);

      expect(res.body.data).toMatchObject({
        pageSlug: PAGE_SLUG,
        type: 'HERO',
        isVisible: true,
        sortOrder: 0,
      });
      expect(res.body.data.config.assetId).toBe(HERO_ASSET_ID);
      sectionId = res.body.data.id as string;
    });

    it('creates a PROMOTIONAL_BANNER section', async () => {
      const res = await api()
        .post(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections`)
        .set('Cookie', adminCookie)
        .send({
          type: 'PROMOTIONAL_BANNER',
          config: validPromotionalBannerConfig(),
          sortOrder: 1,
        })
        .expect(201);

      expect(res.body.data.type).toBe('PROMOTIONAL_BANNER');
      expect(res.body.data.config.assetId).toBe(PROMO_ASSET_ID);
    });

    it('creates a TRUST_SIGNALS section with at least one item', async () => {
      const res = await api()
        .post(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections`)
        .set('Cookie', adminCookie)
        .send({
          type: 'TRUST_SIGNALS',
          config: {
            items: [
              {
                kind: 'delivery',
                title: { default: 'Fast' },
                subtitle: { default: 'Two-day' },
              },
            ],
          },
          sortOrder: 2,
        })
        .expect(201);

      expect(res.body.data.type).toBe('TRUST_SIGNALS');
      expect(res.body.data.config.items).toHaveLength(1);
    });

    it('rejects an invalid section type', async () => {
      await api()
        .post(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections`)
        .set('Cookie', adminCookie)
        .send({ type: 'INVALID_TYPE', config: {} })
        .expect(400);
    });

    it('rejects a deprecated section type that is no longer renderable (DR-05 trim)', async () => {
      await api()
        .post(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections`)
        .set('Cookie', adminCookie)
        .send({ type: 'TESTIMONIALS', config: {} })
        .expect(400);
    });

    it('rejects a HERO config that omits required fields', async () => {
      await api()
        .post(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections`)
        .set('Cookie', adminCookie)
        .send({ type: 'HERO', config: { headline: { default: 'no-asset' } } })
        .expect(400);
    });

    it('rejects unknown fields on a per-type config (whitelist + forbidNonWhitelisted)', async () => {
      await api()
        .post(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections`)
        .set('Cookie', adminCookie)
        .send({
          type: 'HERO',
          config: { ...validHeroConfig(), sneaky: 'no' },
        })
        .expect(400);
    });

    it('rejects a pageSlug with illegal characters', async () => {
      await api()
        .post(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections`)
        .set('Cookie', adminCookie)
        .send({ type: 'HERO', config: validHeroConfig(), pageSlug: 'Home Page!' })
        .expect(400);
    });

    it('returns 401 without auth', async () => {
      await api()
        .post(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections`)
        .send({ type: 'HERO', config: validHeroConfig() })
        .expect(401);
    });
  });

  // ── Admin: list pages ──────────────────────────────────────────────────────

  describe('GET /v1/admin/storefront/pages', () => {
    it('lists page slugs that have sections', async () => {
      const res = await api()
        .get('/v1/admin/storefront/pages')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toContain(PAGE_SLUG);
    });

    it('returns 401 without auth', async () => {
      await api().get('/v1/admin/storefront/pages').expect(401);
    });
  });

  // ── Admin: list sections for page ──────────────────────────────────────────

  describe('GET /v1/admin/storefront/pages/:pageSlug/sections', () => {
    it('returns all sections for the page (admin view)', async () => {
      const res = await api()
        .get(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20 });
    });

    it('supports pagination', async () => {
      const res = await api()
        .get(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections?page=1&pageSize=5`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.meta.pageSize).toBe(5);
    });
  });

  // ── Storefront: get visible sections ──────────────────────────────────────

  describe('GET /v1/storefront/sections/:pageSlug', () => {
    it('returns visible sections for a page without auth', async () => {
      const res = await api().get(`/v1/storefront/sections/${PAGE_SLUG}`).expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns empty array for unknown page slug', async () => {
      const res = await api()
        .get('/v1/storefront/sections/page-that-does-not-exist-xyz')
        .expect(200);

      expect(res.body.data).toEqual([]);
    });

    it('excludes hidden sections', async () => {
      // Create a hidden TRUST_SIGNALS section on the page
      await api()
        .post(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections`)
        .set('Cookie', adminCookie)
        .send({
          type: 'TRUST_SIGNALS',
          isVisible: false,
          sortOrder: 99,
          config: {
            items: [
              {
                kind: 'delivery',
                title: { default: 'Hidden' },
                subtitle: { default: 'Hidden' },
              },
            ],
          },
        })
        .expect(201);

      const res = await api().get(`/v1/storefront/sections/${PAGE_SLUG}`).expect(200);

      const hiddenIds = (res.body.data as { id: string; isVisible: boolean }[]).filter(
        (s) => s.isVisible === false,
      );
      expect(hiddenIds).toHaveLength(0);
    });

    it('excludes sections whose visibleUntil is in the past', async () => {
      await api()
        .post(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections`)
        .set('Cookie', adminCookie)
        .send({
          type: 'PROMOTIONAL_BANNER',
          isVisible: true,
          sortOrder: 98,
          visibleFrom: '2020-01-01T00:00:00.000Z',
          visibleUntil: '2020-12-31T23:59:59.000Z',
          config: validPromotionalBannerConfig(),
        });

      const res = await api().get(`/v1/storefront/sections/${PAGE_SLUG}`).expect(200);

      const sortOrders = (res.body.data as { sortOrder: number }[]).map((s) => s.sortOrder);
      expect(sortOrders).not.toContain(98);
    });

    it('orders sections by sortOrder ascending', async () => {
      const res = await api().get(`/v1/storefront/sections/${PAGE_SLUG}`).expect(200);

      const orders = (res.body.data as { sortOrder: number }[]).map((s) => s.sortOrder);
      for (let i = 1; i < orders.length; i++) {
        expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1]);
      }
    });

    it('returns the meta envelope with pageSlug + total', async () => {
      const res = await api().get(`/v1/storefront/sections/${PAGE_SLUG}`).expect(200);

      expect(res.body.meta).toMatchObject({ pageSlug: PAGE_SLUG });
      expect(typeof res.body.meta.total).toBe('number');
      expect(res.body.meta.total).toBe((res.body.data as unknown[]).length);
    });

    it('rejects an invalid pageSlug with 400 (kebab-case allowlist)', async () => {
      await api().get('/v1/storefront/sections/Bad%20Slug%21').expect(400);
    });
  });

  // ── Admin: update section ──────────────────────────────────────────────────

  describe('PATCH /v1/admin/storefront/sections/:id', () => {
    it('replaces the per-type config wholesale', async () => {
      const fresh = { ...validHeroConfig(), eyebrow: { default: 'Updated' } };
      const res = await api()
        .patch(`/v1/admin/storefront/sections/${sectionId}`)
        .set('Cookie', adminCookie)
        // Admin edit path — keep Translatable config fields raw, not resolved.
        .set('X-Resolve-Locale', 'false')
        .send({ type: 'HERO', config: fresh })
        .expect(200);

      expect(res.body.data.config.eyebrow.default).toBe('Updated');
    });

    it('rejects an envelope+config patch whose config violates the type schema', async () => {
      await api()
        .patch(`/v1/admin/storefront/sections/${sectionId}`)
        .set('Cookie', adminCookie)
        .send({ type: 'HERO', config: { headline: { default: 'no-asset' } } })
        .expect(400);
    });

    it('returns 404 for unknown id', async () => {
      await api()
        .patch('/v1/admin/storefront/sections/non-existent-id')
        .set('Cookie', adminCookie)
        .send({ sortOrder: 1 })
        .expect(404);
    });
  });

  // ── Admin: toggle visibility ───────────────────────────────────────────────

  describe('PATCH /v1/admin/storefront/sections/:id/visibility', () => {
    it('hides a section', async () => {
      const res = await api()
        .patch(`/v1/admin/storefront/sections/${sectionId}/visibility`)
        .set('Cookie', adminCookie)
        .send({ isVisible: false })
        .expect(200);

      expect(res.body.data.isVisible).toBe(false);
    });

    it('shows the section again', async () => {
      const res = await api()
        .patch(`/v1/admin/storefront/sections/${sectionId}/visibility`)
        .set('Cookie', adminCookie)
        .send({ isVisible: true })
        .expect(200);

      expect(res.body.data.isVisible).toBe(true);
    });

    it('sets a visibility window', async () => {
      const res = await api()
        .patch(`/v1/admin/storefront/sections/${sectionId}/visibility`)
        .set('Cookie', adminCookie)
        .send({
          isVisible: true,
          visibleFrom: '2026-06-01T00:00:00.000Z',
          visibleUntil: '2026-12-31T23:59:59.000Z',
        })
        .expect(200);

      expect(res.body.data.visibleFrom).toBeDefined();
      expect(res.body.data.visibleUntil).toBeDefined();
    });

    it('rejects when isVisible is missing', async () => {
      await api()
        .patch(`/v1/admin/storefront/sections/${sectionId}/visibility`)
        .set('Cookie', adminCookie)
        .send({ visibleFrom: '2026-06-01T00:00:00.000Z' })
        .expect(400);
    });
  });

  // ── Admin: reorder sections ────────────────────────────────────────────────

  describe('PATCH /v1/admin/storefront/pages/:pageSlug/sections/reorder', () => {
    it('reorders sections successfully', async () => {
      // Get current section IDs on page
      const listRes = await api()
        .get(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections?pageSize=100`)
        .set('Cookie', adminCookie)
        .expect(200);

      const ids = (listRes.body.data as { id: string }[]).map((s) => s.id);
      const reversed = [...ids].reverse();

      await api()
        .patch(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections/reorder`)
        .set('Cookie', adminCookie)
        .send({ orderedIds: reversed })
        .expect(204);
    });

    it('rejects IDs not belonging to the page', async () => {
      await api()
        .patch(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections/reorder`)
        .set('Cookie', adminCookie)
        .send({ orderedIds: ['non-existent-id-xyz'] })
        .expect(400);
    });

    it('rejects empty orderedIds', async () => {
      await api()
        .patch(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections/reorder`)
        .set('Cookie', adminCookie)
        .send({ orderedIds: [] })
        .expect(400);
    });
  });

  // ── Storefront: Translatable resolution via Accept-Language ───────────────

  describe('Translatable resolution on GET /v1/storefront/sections/:pageSlug', () => {
    let bilingualSectionId: string;

    beforeAll(async () => {
      // Only the store's two enabled locales can be submitted (IsEnabledLocale,
      // plan E1.3.4). `default` and the secondary locale carry the same value;
      // the default locale carries a distinct one, so the "falls through"
      // case below can pin exactly which rung it landed on.
      const res = await api()
        .post(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections`)
        .set('Cookie', adminCookie)
        .send({
          type: 'TRUST_SIGNALS',
          title: {
            default: 'Confiance secondary-locale',
            [STORE_SECONDARY_LOCALE]: 'Confiance secondary-locale',
            [STORE_DEFAULT_LOCALE]: 'Confiance default-locale',
          },
          isVisible: true,
          sortOrder: 200,
          config: {
            items: [
              {
                kind: 'delivery',
                title: {
                  default: 'Rapide secondary-locale',
                  [STORE_SECONDARY_LOCALE]: 'Rapide secondary-locale',
                  [STORE_DEFAULT_LOCALE]: 'Rapide default-locale',
                },
                subtitle: {
                  default: 'Livraison secondary-locale',
                  [STORE_SECONDARY_LOCALE]: 'Livraison secondary-locale',
                  [STORE_DEFAULT_LOCALE]: 'Livraison default-locale',
                },
              },
            ],
          },
        });
      bilingualSectionId = res.body.data.id as string;
    });

    it('resolves Translatable strings to the Accept-Language locale (secondary)', async () => {
      const res = await api()
        .get(`/v1/storefront/sections/${PAGE_SLUG}`)
        .set('Accept-Language', STORE_SECONDARY_LOCALE)
        .expect(200);

      const row = (res.body.data as Array<{ id: string; title: unknown }>).find(
        (r) => r.id === bilingualSectionId,
      );
      expect(row).toBeDefined();
      expect(row!.title).toBe('Confiance secondary-locale');
    });

    it('falls through to the store default rung when the requested locale is not stored', async () => {
      const res = await api()
        .get(`/v1/storefront/sections/${PAGE_SLUG}`)
        .set('Accept-Language', 'de')
        .expect(200);

      const row = (res.body.data as Array<{ id: string; title: unknown }>).find(
        (r) => r.id === bilingualSectionId,
      );
      expect(row).toBeDefined();
      // `default` and the secondary locale both carry the "secondary-locale"
      // string and the store default locale carries its own distinct one, so
      // only that rung can produce this string. An unsupported locale must
      // traverse the requested rung, miss, and land there.
      expect(row!.title).toBe('Confiance default-locale');
    });

    it('returns the raw Translatable shape when X-Resolve-Locale: false is sent (admin reads)', async () => {
      const res = await api()
        .get(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections?pageSize=100`)
        .set('Cookie', adminCookie)
        .set('X-Resolve-Locale', 'false')
        .set('Accept-Language', STORE_SECONDARY_LOCALE)
        .expect(200);

      const row = (res.body.data as Array<{ id: string; title: unknown }>).find(
        (r) => r.id === bilingualSectionId,
      );
      expect(row).toBeDefined();
      // X-Resolve-Locale: false → the title comes through as the raw JSONB
      // object so admin operators can edit every locale tab.
      expect(row!.title).toMatchObject({
        default: 'Confiance secondary-locale',
        [STORE_SECONDARY_LOCALE]: 'Confiance secondary-locale',
        [STORE_DEFAULT_LOCALE]: 'Confiance default-locale',
      });
    });
  });

  // ── Admin: delete section ─────────────────────────────────────────────────

  describe('DELETE /v1/admin/storefront/sections/:id', () => {
    it('soft-deletes a section', async () => {
      // Create a throwaway section
      const createRes = await api()
        .post(`/v1/admin/storefront/pages/${PAGE_SLUG}/sections`)
        .set('Cookie', adminCookie)
        .send({
          type: 'CATEGORY_SHOWCASE',
          sortOrder: 50,
          config: { categoryIds: ['44444444-4444-4444-8444-444444444444'] },
        })
        .expect(201);

      const id = createRes.body.data.id as string;

      await api()
        .delete(`/v1/admin/storefront/sections/${id}`)
        .set('Cookie', adminCookie)
        .expect(204);

      // Should not appear in storefront output
      const storefrontRes = await api().get(`/v1/storefront/sections/${PAGE_SLUG}`).expect(200);

      const ids = (storefrontRes.body.data as { id: string }[]).map((s) => s.id);
      expect(ids).not.toContain(id);
    });

    it('returns 404 for unknown id', async () => {
      await api()
        .delete('/v1/admin/storefront/sections/non-existent-id')
        .set('Cookie', adminCookie)
        .expect(404);
    });
  });
});
