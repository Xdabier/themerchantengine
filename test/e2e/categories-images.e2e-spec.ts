import type { PrismaClient } from '@prisma/client';

import {
  ADMIN,
  api,
  createTestPrisma,
  loginAs,
  STORE_DEFAULT_LOCALE,
  STORE_SECONDARY_LOCALE,
} from './helpers';

/**
 * Phase B6 — `GET /v1/categories` and `GET /v1/categories/:slug` resolve
 * `Category.imageId` to a public image URL (finding S5 / H4).
 *
 * Eleven dev categories carried an `imageId` that no public endpoint ever
 * turned into a URL, so an image uploaded in the admin was a dead end. This
 * asserts the whole chain against a real asset row: seed a READY Asset, point
 * a category at it through the admin API (which invalidates the tree cache),
 * then read the public endpoints.
 */

const VARIANT_NAMES = ['thumbnail', 'small', 'medium', 'large'] as const;
const VARIANT_WIDTHS: Record<(typeof VARIANT_NAMES)[number], number> = {
  thumbnail: 150,
  small: 400,
  medium: 800,
  large: 1600,
};

/**
 * A full canonical variant payload. `imageAssetVariantsSchema` is `.strict()`
 * and requires all four names in both formats, so a partial payload would
 * resolve to null and the test would pass for the wrong reason.
 */
function buildVariants(marker: string) {
  const out: Record<string, unknown> = {};
  for (const name of VARIANT_NAMES) {
    const width = VARIANT_WIDTHS[name];
    out[name] = {
      webp: {
        url: `https://cdn.test/${marker}-${name}.webp`,
        storagePath: `e2e/${marker}-${name}.webp`,
        width,
        height: width,
        size: 2048,
      },
      avif: {
        url: `https://cdn.test/${marker}-${name}.avif`,
        storagePath: `e2e/${marker}-${name}.avif`,
        width,
        height: width,
        size: 1024,
      },
    };
  }
  return out;
}

describe('Categories — public image hydration (B6)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  let assetId: string;
  let categoryId: string;
  let slug: string;

  const marker = `b6-${Date.now()}`;

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    const asset = await prisma.asset.create({
      data: {
        type: 'IMAGE',
        mimeType: 'image/jpeg',
        fileSize: 4096,
        storagePath: `e2e/${marker}.jpg`,
        url: `https://cdn.test/${marker}-small.webp`,
        status: 'READY',
        variants: buildVariants(marker) as never,
      },
    });
    assetId = asset.id;

    slug = `${marker}-cat`;
    const created = await api()
      .post('/v1/admin/categories')
      .set('Cookie', adminCookie)
      .send({
        name: {
          default: 'B6 image category',
          [STORE_DEFAULT_LOCALE]: 'B6 image category',
          [STORE_SECONDARY_LOCALE]: 'Categorie image B6',
        },
        slug,
        imageId: assetId,
        isVisible: true,
      });
    expect(created.status).toBe(201);
    categoryId = created.body.data.id;
  });

  afterAll(async () => {
    if (categoryId) {
      await api().delete(`/v1/admin/categories/${categoryId}`).set('Cookie', adminCookie);
    }
    if (assetId) {
      await prisma.asset.deleteMany({ where: { id: assetId } });
    }
    await prisma.$disconnect();
  });

  function findBySlug(nodes: Array<Record<string, unknown>>): Record<string, unknown> | undefined {
    for (const node of nodes) {
      if (node['slug'] === slug) return node;
      const children = node['children'];
      if (Array.isArray(children)) {
        const hit = findBySlug(children as Array<Record<string, unknown>>);
        if (hit) return hit;
      }
    }
    return undefined;
  }

  it('GET /v1/categories resolves imageId to a card-intent imageUrl', async () => {
    const res = await api().get('/v1/categories');
    expect(res.status).toBe(200);

    // Jest's expect takes no message argument, so the context goes in a
    // comment: this row is the category created in beforeAll.
    const row = findBySlug(res.body.data);
    expect(row).toBeDefined();
    expect(row!['imageUrl']).toBe(`https://cdn.test/${marker}-small.webp`);
    expect(Array.isArray(row!['imageVariants'])).toBe(true);
    expect((row!['imageVariants'] as unknown[]).length).toBeGreaterThan(0);
    // The relation is an implementation detail and must not ship.
    expect(row).not.toHaveProperty('image');
  });

  it('GET /v1/categories/:slug resolves it the same way', async () => {
    const res = await api().get(`/v1/categories/${slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.imageUrl).toBe(`https://cdn.test/${marker}-small.webp`);
    expect(res.body.data).not.toHaveProperty('image');
  });

  it('emits a null imageUrl for a category with no image', async () => {
    const res = await api().get('/v1/categories');
    expect(res.status).toBe(200);

    const flat: Array<Record<string, unknown>> = [];
    const walk = (nodes: Array<Record<string, unknown>>) => {
      for (const n of nodes) {
        flat.push(n);
        if (Array.isArray(n['children'])) walk(n['children'] as Array<Record<string, unknown>>);
      }
    };
    walk(res.body.data);

    // The seed must leave at least one imageless category, otherwise the loop
    // below asserts nothing.
    const withoutImage = flat.filter((n) => n['imageId'] === null);
    expect(withoutImage.length).toBeGreaterThan(0);
    for (const node of withoutImage) {
      expect(node['imageUrl']).toBeNull();
    }
  });
});
