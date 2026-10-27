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

const TEST_SUFFIX = '@e2e-cms.test';
// A slug-safe tag for page slugs — `TEST_SUFFIX` carries `@` and `.`, which the
// page-slug validator rejects.
const SLUG_TAG = 'e2e-cms-test';
const TEST_PASSWORD = 'StrongPass1!';

// ── Suite ────────────────────────────────────────────────────────────────────

describe('CMS (e2e)', () => {
  let prisma: PrismaClient;

  let adminCookie: string;
  let pageId: string;

  // ── Setup ──────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    prisma = createTestPrisma();

    // Register an admin user carrying the CMS permission set.
    await createUserWithRole(prisma, {
      email: `admin${TEST_SUFFIX}`,
      password: TEST_PASSWORD,
      role: 'ADMIN',
      permissions: ['cms:view', 'cms:create', 'cms:update', 'cms:delete'],
      firstName: 'CMS',
      lastName: 'Admin',
    });

    adminCookie = await loginAs(`admin${TEST_SUFFIX}`, TEST_PASSWORD);
  });

  afterAll(async () => {
    // Clean up test pages (by slug pattern)
    await prisma.cmsPage.deleteMany({
      where: { slug: { contains: SLUG_TAG } },
    });
    await prisma.user.deleteMany({ where: { email: { contains: TEST_SUFFIX } } });
    await prisma.$disconnect();
  });

  // ── Admin: create page ─────────────────────────────────────────────────────

  describe('POST /v1/admin/pages', () => {
    it('creates a new STATIC page', async () => {
      const res = await api()
        .post('/v1/admin/pages')
        .set('Cookie', adminCookie)
        .send({
          slug: `/test-page-${SLUG_TAG}`,
          type: 'STATIC',
          title: { default: 'Page de test', en: 'Test Page' },
          content: { default: 'Test content here.' },
          isPublished: true,
          showInNavigation: true,
          sortOrder: 99,
        })
        .expect(201);

      expect(res.body.data).toMatchObject({
        slug: `/test-page-${SLUG_TAG}`,
        type: 'STATIC',
        isPublished: true,
        showInNavigation: true,
        sortOrder: 99,
      });
      pageId = res.body.data.id as string;
    });

    it('defaults isPublished to false', async () => {
      const res = await api()
        .post('/v1/admin/pages')
        .set('Cookie', adminCookie)
        .send({
          slug: `/draft-${SLUG_TAG}`,
          type: 'POLICY',
          title: { default: 'Draft Page' },
          content: { default: 'Draft content' },
        })
        .expect(201);

      expect(res.body.data.isPublished).toBe(false);
    });

    it('rejects invalid slug (missing leading slash)', async () => {
      await api()
        .post('/v1/admin/pages')
        .set('Cookie', adminCookie)
        .send({
          slug: 'no-slash',
          type: 'STATIC',
          title: { default: 'Bad' },
          content: { default: 'Bad' },
        })
        .expect(400);
    });

    it('rejects invalid CmsPageType', async () => {
      await api()
        .post('/v1/admin/pages')
        .set('Cookie', adminCookie)
        .send({
          slug: `/bad-type-${SLUG_TAG}`,
          type: 'INVALID',
          title: { default: 'Bad' },
          content: { default: 'Bad' },
        })
        .expect(400);
    });

    it('returns 401 without auth', async () => {
      await api()
        .post('/v1/admin/pages')
        .send({
          slug: '/test',
          type: 'STATIC',
          title: { default: 'Test' },
          content: { default: 'Test' },
        })
        .expect(401);
    });
  });

  // ── Admin: list pages ──────────────────────────────────────────────────────

  describe('GET /v1/admin/pages', () => {
    it('returns all pages (including unpublished) with pagination', async () => {
      const res = await api().get('/v1/admin/pages').set('Cookie', adminCookie).expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20 });
    });

    it('supports pagination parameters', async () => {
      const res = await api()
        .get('/v1/admin/pages?page=1&pageSize=5')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.meta.pageSize).toBe(5);
    });

    it('returns 401 without auth', async () => {
      await api().get('/v1/admin/pages').expect(401);
    });
  });

  // ── Storefront: get pages ──────────────────────────────────────────────────

  describe('GET /v1/pages', () => {
    it('returns only published pages without auth', async () => {
      const res = await api().get('/v1/pages').expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      // All returned pages should be published
      const allPublished = (res.body.data as { isPublished: boolean }[]).every(
        (p) => p.isPublished,
      );
      expect(allPublished).toBe(true);
    });

    it('includes default seeded pages', async () => {
      const res = await api().get('/v1/pages').expect(200);

      const slugs = (res.body.data as { slug: string }[]).map((p) => p.slug);
      expect(slugs).toContain('/about');
      expect(slugs).toContain('/contact');
    });

    it('orders pages by sortOrder ascending', async () => {
      const res = await api().get('/v1/pages').expect(200);

      const orders = (res.body.data as { sortOrder: number }[]).map((p) => p.sortOrder);
      for (let i = 1; i < orders.length; i++) {
        expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1]);
      }
    });
  });

  // ── Storefront: get page by slug ───────────────────────────────────────────

  describe('GET /v1/pages/:slug', () => {
    it('returns a published page by slug', async () => {
      const res = await api().get('/v1/pages/about').expect(200);

      expect(res.body.data).toMatchObject({ slug: '/about', isPublished: true });
    });

    it('returns 404 for non-existent page', async () => {
      await api().get('/v1/pages/does-not-exist-xyz').expect(404);
    });

    it('returns 404 for unpublished page', async () => {
      // Create an unpublished page
      await api()
        .post('/v1/admin/pages')
        .set('Cookie', adminCookie)
        .send({
          slug: `/unpublished-${SLUG_TAG}`,
          type: 'STATIC',
          title: { default: 'Unpublished' },
          content: { default: 'Hidden' },
          isPublished: false,
        })
        .expect(201);

      // Try to fetch it from storefront — should 404
      await api().get(`/v1/pages/unpublished-${SLUG_TAG}`).expect(404);
    });

    it('handles multi-level slugs (e.g. /category/subcategory)', async () => {
      const slug = `/nested/path-${SLUG_TAG}`;
      await api()
        .post('/v1/admin/pages')
        .set('Cookie', adminCookie)
        .send({
          slug,
          type: 'STATIC',
          title: { default: 'Nested' },
          content: { default: 'Nested content' },
          isPublished: true,
        })
        .expect(201);

      const res = await api().get(`/v1/pages/nested/path-${SLUG_TAG}`).expect(200);

      expect(res.body.data.slug).toBe(slug);
    });
  });

  // ── Admin: update page ─────────────────────────────────────────────────────

  describe('PATCH /v1/admin/pages/:id', () => {
    it('updates page fields', async () => {
      const res = await api()
        .patch(`/v1/admin/pages/${pageId}`)
        .set('Cookie', adminCookie)
        // Admin edit path — keep Translatable fields raw, not locale-resolved.
        .set('X-Resolve-Locale', 'false')
        .send({
          isPublished: false,
          sortOrder: 50,
          title: { default: 'Updated Title', en: 'Updated Title' },
        })
        .expect(200);

      expect(res.body.data).toMatchObject({
        isPublished: false,
        sortOrder: 50,
        title: expect.objectContaining({ default: 'Updated Title' }),
      });
    });

    it('returns 404 for unknown page', async () => {
      await api()
        .patch('/v1/admin/pages/non-existent-id')
        .set('Cookie', adminCookie)
        .send({ isPublished: true })
        .expect(404);
    });

    it('cannot change slug via update', async () => {
      // The update DTO does not accept `slug` — the page slug is immutable, so
      // a request that tries to change it is rejected outright.
      await api()
        .patch(`/v1/admin/pages/${pageId}`)
        .set('Cookie', adminCookie)
        .send({ slug: '/new-slug' })
        .expect(400);
    });

    it('accepts metaTitle and metaDescription updates', async () => {
      const res = await api()
        .patch(`/v1/admin/pages/${pageId}`)
        .set('Cookie', adminCookie)
        // Admin edit path — keep Translatable fields raw, not locale-resolved.
        .set('X-Resolve-Locale', 'false')
        .send({
          metaTitle: { default: 'SEO Title', en: 'SEO Title' },
          metaDescription: { default: 'SEO Description' },
        })
        .expect(200);

      expect(res.body.data.metaTitle).toEqual(expect.objectContaining({ default: 'SEO Title' }));
      expect(res.body.data.metaDescription).toEqual(
        expect.objectContaining({ default: 'SEO Description' }),
      );
    });
  });

  // ── Admin: delete page ─────────────────────────────────────────────────────

  describe('DELETE /v1/admin/pages/:id', () => {
    it('soft-deletes a page', async () => {
      // Create a throwaway page
      const createRes = await api()
        .post('/v1/admin/pages')
        .set('Cookie', adminCookie)
        .send({
          slug: `/delete-me-${SLUG_TAG}`,
          type: 'STATIC',
          title: { default: 'Deletable' },
          content: { default: 'Will be deleted' },
          isPublished: true,
        })
        .expect(201);

      const id = createRes.body.data.id as string;

      await api().delete(`/v1/admin/pages/${id}`).set('Cookie', adminCookie).expect(204);

      // Page should not appear in storefront
      await api().get(`/v1/pages/delete-me-${SLUG_TAG}`).expect(404);
    });

    it('returns 404 for unknown page', async () => {
      await api().delete('/v1/admin/pages/non-existent-id').set('Cookie', adminCookie).expect(404);
    });

    it('returns 401 without auth', async () => {
      await api().delete(`/v1/admin/pages/${pageId}`).expect(401);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Accept-Language matrix (§1.14 BLOCKER 6 — E5)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Closes the §1.14 BLOCKER 6 finding for the CMS module. Targets the public
// storefront route `GET /v1/pages/:slug(*)` which returns CmsPage with
// Translatable `title` + `content`. The out-of-process API already mounts the
// ApiResponse + Translatable interceptors globally, so the matrix runs against
// the same shared instance.

describe('Accept-Language matrix (E5 §1.14 BLOCKER 6 — cms)', () => {
  const MATRIX_SLUG = `/e2e-matrix-page-${Date.now()}`;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrisma();

    await prisma.cmsPage.create({
      data: {
        slug: MATRIX_SLUG,
        // `default` and the secondary locale carry the same value; the
        // store's default locale carries a distinct one (see products.e2e-spec.ts matrix).
        title: {
          default: 'Titre matrice secondary-locale',
          [STORE_SECONDARY_LOCALE]: 'Titre matrice secondary-locale',
          [STORE_DEFAULT_LOCALE]: 'Titre matrice default-locale',
        },
        content: {
          default: '<p>Contenu matrice secondary-locale</p>',
          [STORE_SECONDARY_LOCALE]: '<p>Contenu matrice secondary-locale</p>',
          [STORE_DEFAULT_LOCALE]: '<p>Contenu matrice default-locale</p>',
        },
        type: 'STATIC',
        isPublished: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.cmsPage.deleteMany({ where: { slug: MATRIX_SLUG } });
    await prisma.$disconnect();
  });

  it('resolves Translatable title to the store default locale', async () => {
    const res = await api()
      .get(`/v1/pages${MATRIX_SLUG}`)
      .set('Accept-Language', STORE_DEFAULT_LOCALE);
    expect(res.status).toBe(200);
    expect(res.body.data?.title).toBe('Titre matrice default-locale');
  });

  it('resolves Translatable title to the store secondary locale', async () => {
    const res = await api()
      .get(`/v1/pages${MATRIX_SLUG}`)
      .set('Accept-Language', STORE_SECONDARY_LOCALE);
    expect(res.status).toBe(200);
    expect(res.body.data?.title).toBe('Titre matrice secondary-locale');
  });

  it('returns full Translatable object when X-Resolve-Locale: false', async () => {
    const res = await api().get(`/v1/pages${MATRIX_SLUG}`).set('X-Resolve-Locale', 'false');
    expect(res.status).toBe(200);
    expect(res.body.data?.title).toEqual({
      default: 'Titre matrice secondary-locale',
      [STORE_SECONDARY_LOCALE]: 'Titre matrice secondary-locale',
      [STORE_DEFAULT_LOCALE]: 'Titre matrice default-locale',
    });
  });

  it('falls through to the store default rung on an unsupported Accept-Language (de)', async () => {
    const res = await api().get(`/v1/pages${MATRIX_SLUG}`).set('Accept-Language', 'de');
    expect(res.status).toBe(200);
    // `default` and the secondary locale carry the same value and the store's
    // default locale differs, so only the default rung can produce this
    // string. An unsupported locale must reach it.
    expect(res.body.data?.title).toBe('Titre matrice default-locale');
  });
});
