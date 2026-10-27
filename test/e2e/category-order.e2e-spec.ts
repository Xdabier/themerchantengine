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
 * The category nav returns the same order twice.
 *
 * `getTree` ordered by (depth, sortOrder), and every category this project
 * seeds shares `sortOrder: 0`, so that is not an order: Postgres returns rows
 * in physical order and an UPDATE anywhere in the table can rewrite it. A
 * customer sees the nav reshuffle between page loads.
 *
 * It surfaced as eighteen visual-regression baselines that failed against
 * screenshots taken minutes earlier, every one of them at the single viewport
 * where the category bar sits on a wrap boundary, so one moved category
 * changed the page height.
 *
 * Asserted as "the same order twice, across a write that moves rows", not as
 * one hardcoded sequence: the seed's category set is not this spec's business,
 * and pinning it would break on every catalogue change.
 */

const MARKER = `catorder-${Date.now()}`;
const SIBLINGS = ['zulu', 'alpha', 'mike', 'bravo'];

describe('Category order (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  const created: string[] = [];

  async function slugsOfTree(): Promise<string[]> {
    const res = await api().get('/v1/categories');
    expect(res.status).toBe(200);

    const out: string[] = [];
    const walk = (nodes: { slug: string; children?: unknown[] }[]): void => {
      for (const node of nodes) {
        out.push(node.slug);
        if (node.children) walk(node.children as typeof nodes);
      }
    };
    walk(res.body.data);
    return out;
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    // Deliberately created out of alphabetical order and all on sortOrder 0,
    // which is the tie the ordering has to resolve.
    for (const name of SIBLINGS) {
      const res = await api()
        .post('/v1/admin/categories')
        .set('Cookie', adminCookie)
        .send({
          name: { default: name, [STORE_DEFAULT_LOCALE]: name, [STORE_SECONDARY_LOCALE]: name },
          slug: `${MARKER}-${name}`,
          isVisible: true,
        });
      expect(res.status).toBe(201);
      created.push(res.body.data.id);
    }
  });

  afterAll(async () => {
    if (created.length) {
      await prisma.category.deleteMany({ where: { id: { in: created } } });
    }
    await prisma.$disconnect();
  });

  it('orders tied siblings by slug rather than by physical row order', async () => {
    const slugs = (await slugsOfTree()).filter((s) => s.startsWith(MARKER));

    expect(slugs).toEqual([
      `${MARKER}-alpha`,
      `${MARKER}-bravo`,
      `${MARKER}-mike`,
      `${MARKER}-zulu`,
    ]);
  });

  it('returns the same order after a write that moves rows on disk', async () => {
    const before = await slugsOfTree();

    // A no-op-ish UPDATE on every row this spec owns. Postgres writes new row
    // versions, which is exactly what used to reshuffle an unordered read.
    for (const id of created) {
      const res = await api()
        .patch(`/v1/admin/categories/${id}`)
        .set('Cookie', adminCookie)
        .send({ isVisible: true });
      expect(res.status).toBe(200);
    }

    expect(await slugsOfTree()).toEqual(before);
  });

  it('pages the category product listing without repeating a row', async () => {
    // Any seeded category with enough products. The listing is what carries the
    // pagination risk: page 2 of an unspecified order can repeat page 1.
    const tree = await api().get('/v1/categories');
    const roots = tree.body.data as { slug: string }[];
    const slug = roots.find((c) => !c.slug.startsWith(MARKER))?.slug;
    if (!slug) return;

    const page1 = await api().get(`/v1/categories/${slug}/products?page=1&pageSize=2`);
    const page2 = await api().get(`/v1/categories/${slug}/products?page=2&pageSize=2`);
    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);

    const ids = [
      ...(page1.body.data as { id: string }[]).map((p) => p.id),
      ...(page2.body.data as { id: string }[]).map((p) => p.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
