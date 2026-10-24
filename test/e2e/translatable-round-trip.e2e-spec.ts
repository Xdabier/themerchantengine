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
 * Read a Translatable field through the admin API, write the same value back,
 * and get a 200. And clear an optional one.
 *
 * Neither worked for a category description. `TranslatableDto.default` carries
 * `@IsNotEmpty()`, which is right for a name and wrong for optional content:
 *
 * - `null` is skipped by `@IsOptional()`, so the previous value survives,
 * - `{}` fails the nested shape,
 * - `{ default: '' }` fails `@IsNotEmpty()`.
 *
 * So an operator who filled in a category description could never remove it,
 * and `rich-text.journey.spec.ts` could not restore the row it borrowed. Its
 * `finally` has carried a comment describing all three dead ends since it was
 * written; the refusal it hit answered `messages: []` and named no reason,
 * which is why it stayed a mystery rather than a one-line fix.
 *
 * A name is still required to be non-empty. That is the distinction being
 * pinned here, not "validation is looser now".
 */

const MARKER = `trt-${Date.now()}`;

describe('Translatable round trip (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  let categoryId: string;
  let productId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    const category = await api()
      .post('/v1/admin/categories')
      .set('Cookie', adminCookie)
      .send({
        name: {
          default: 'Round trip',
          [STORE_DEFAULT_LOCALE]: 'Round trip',
          [STORE_SECONDARY_LOCALE]: 'Aller-retour',
        },
        slug: `${MARKER}-cat`,
        description: {
          default: 'Some intro',
          [STORE_DEFAULT_LOCALE]: 'Some intro',
          [STORE_SECONDARY_LOCALE]: 'Une intro',
        },
        isVisible: true,
      });
    expect(category.status).toBe(201);
    categoryId = category.body.data.id;

    const product = await api()
      .post('/v1/admin/products')
      .set('Cookie', adminCookie)
      .send({
        name: {
          default: 'Round trip product',
          [STORE_DEFAULT_LOCALE]: 'Round trip product',
          [STORE_SECONDARY_LOCALE]: 'Produit aller',
        },
        slug: `${MARKER}-product`,
        description: {
          default: 'Some copy',
          [STORE_DEFAULT_LOCALE]: 'Some copy',
          [STORE_SECONDARY_LOCALE]: 'Du texte',
        },
      });
    expect(product.status).toBe(201);
    productId = product.body.data.id;
  });

  afterAll(async () => {
    if (productId) {
      await prisma.product.deleteMany({ where: { id: productId } });
    }
    if (categoryId) {
      await prisma.category.deleteMany({ where: { id: categoryId } });
    }
    await prisma.$disconnect();
  });

  /**
   * The raw stored Translatable, read the way the admin screens and
   * `rich-text.journey.spec.ts` read it: off the admin tree with the resolver
   * turned off. There is no admin GET-by-id for a category.
   */
  async function readCategoryDescription(): Promise<unknown> {
    const res = await api()
      .get('/v1/admin/categories')
      .set('Cookie', adminCookie)
      .set('X-Resolve-Locale', 'false');
    expect(res.status).toBe(200);

    const flat: { id: string; description: unknown }[] = [];
    const walk = (nodes: { id: string; description: unknown; children?: unknown[] }[]): void => {
      for (const node of nodes) {
        flat.push(node);
        if (node.children) walk(node.children as typeof nodes);
      }
    };
    walk(res.body.data);

    const row = flat.find((entry) => entry.id === categoryId);
    expect(row).toBeDefined();
    return row!.description;
  }

  // ── Categories ─────────────────────────────────────────────────────────────

  it('accepts the description it just handed out, unchanged', async () => {
    // On a row that has been cleared, which is the case that failed. A populated
    // row round-trips fine even with the old rule, so reading whatever the
    // fixture happens to hold would pass for the wrong reason.
    await api()
      .patch(`/v1/admin/categories/${categoryId}`)
      .set('Cookie', adminCookie)
      .send({
        description: { default: '', [STORE_DEFAULT_LOCALE]: '', [STORE_SECONDARY_LOCALE]: '' },
      });

    const description = await readCategoryDescription();
    expect(description).toMatchObject({ default: '' });

    const res = await api()
      .patch(`/v1/admin/categories/${categoryId}`)
      .set('Cookie', adminCookie)
      .send({ description });

    expect(res.status).toBe(200);
  });

  it('clears an optional description with an empty default', async () => {
    const res = await api()
      .patch(`/v1/admin/categories/${categoryId}`)
      .set('Cookie', adminCookie)
      .send({
        description: { default: '', [STORE_DEFAULT_LOCALE]: '', [STORE_SECONDARY_LOCALE]: '' },
      });

    expect(res.status).toBe(200);
    expect(await readCategoryDescription()).toMatchObject({ default: '' });
  });

  it('clears an optional metaDescription with an empty default', async () => {
    const res = await api()
      .patch(`/v1/admin/categories/${categoryId}`)
      .set('Cookie', adminCookie)
      .send({
        metaDescription: { default: '', [STORE_DEFAULT_LOCALE]: '', [STORE_SECONDARY_LOCALE]: '' },
      });

    expect(res.status).toBe(200);
  });

  it('still refuses an empty name', async () => {
    const res = await api()
      .patch(`/v1/admin/categories/${categoryId}`)
      .set('Cookie', adminCookie)
      .send({ name: { default: '', [STORE_DEFAULT_LOCALE]: '', [STORE_SECONDARY_LOCALE]: '' } });

    expect(res.status).toBe(400);
    // The reason has to reach the caller. An empty `messages` array is the
    // defect this pins alongside the rule itself.
    const details = res.body.error.details as Array<{ field: string; messages: string[] }>;
    expect(details.some((d) => d.messages.length > 0)).toBe(true);
    expect(details.map((d) => d.field)).toContain('name.default');
  });

  // ── Products, the same field class ─────────────────────────────────────────

  it('clears an optional product description with an empty default', async () => {
    const res = await api()
      .patch(`/v1/admin/products/${productId}`)
      .set('Cookie', adminCookie)
      .send({
        description: { default: '', [STORE_DEFAULT_LOCALE]: '', [STORE_SECONDARY_LOCALE]: '' },
      });

    expect(res.status).toBe(200);
  });

  it('still refuses an empty product name', async () => {
    const res = await api()
      .patch(`/v1/admin/products/${productId}`)
      .set('Cookie', adminCookie)
      .send({ name: { default: '', [STORE_DEFAULT_LOCALE]: '', [STORE_SECONDARY_LOCALE]: '' } });

    expect(res.status).toBe(400);
  });
});
