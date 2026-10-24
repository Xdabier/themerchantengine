import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { NEUTRAL_STORE_CONFIG } from '../../../../libs/shared/common/src/store-config/neutral-store-config';
import {
  loadStoreConfigFixture,
  runtimeConfigOfFixture,
} from '../../../../libs/shared/common/src/store-config-fixtures';
import { DEFAULT_HOME_SECTION_IDS, seedDefaultHomeSections } from '../home-sections';

/**
 * The home page a fresh install serves (plan E2.5.2). Before this the baseline
 * seed planted nothing and a store rendered an empty home page.
 */

const CATEGORIES = [{ id: 'cat-a' }, { id: 'cat-b' }];
const PRODUCTS = [{ id: 'prod-a' }, { id: 'prod-b' }];

function prismaStub(
  existing: { id: string } | null,
  categories: { id: string }[] = CATEGORIES,
  products: { id: string }[] = PRODUCTS,
) {
  const upsert = vi.fn().mockResolvedValue({});
  const findFirst = vi.fn().mockResolvedValue(existing);
  const findMany = vi.fn().mockResolvedValue(categories);
  const findProducts = vi.fn().mockResolvedValue(products);
  return {
    client: {
      storefrontSection: { findFirst, upsert },
      category: { findMany },
      product: { findMany: findProducts },
    } as unknown as PrismaClient,
    findFirst,
    findMany,
    findProducts,
    upsert,
  };
}

function plantedConfig(upsert: ReturnType<typeof vi.fn>, id: string): Record<string, unknown> {
  const call = upsert.mock.calls
    .map(([args]) => args as Record<string, never>)
    .find((c) => (c['where'] as { id: string }).id === id);
  return (call?.['create'] as unknown as Record<string, unknown>)?.['config'] as Record<
    string,
    unknown
  >;
}

const DEMO = runtimeConfigOfFixture(loadStoreConfigFixture('demo'));

describe('seedDefaultHomeSections', () => {
  it('plants a section for every default id, in order, visible', async () => {
    const { client, upsert } = prismaStub(null);
    const result = await seedDefaultHomeSections(client, DEMO);

    expect(result).toEqual({ planted: DEFAULT_HOME_SECTION_IDS.length, skipped: false });
    expect(upsert).toHaveBeenCalledTimes(DEFAULT_HOME_SECTION_IDS.length);
    const planted = upsert.mock.calls.map(([args]) => args as Record<string, never>);
    expect(planted.map((c) => (c['where'] as { id: string }).id)).toEqual([
      ...DEFAULT_HOME_SECTION_IDS,
    ]);
    for (const call of planted) {
      const create = call['create'] as unknown as Record<string, unknown>;
      expect(create['pageSlug']).toBe('home');
      expect(create['isVisible']).toBe(true);
      expect(create['deletedAt']).toBeNull();
    }
    const orders = planted.map(
      (c) => ((c['create'] as unknown as Record<string, unknown>)['sortOrder'] as number) ?? -1,
    );
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('names no section type that needs an image nobody has uploaded', async () => {
    // A hero or a promotional banner reads an assetId. On a fresh install there
    // is none, and an empty image slot on the first page a customer sees is
    // worse than no section at all.
    const { client, upsert } = prismaStub(null);
    await seedDefaultHomeSections(client, DEMO);
    const types = upsert.mock.calls.map(
      ([args]) =>
        ((args as Record<string, never>)['create'] as unknown as Record<string, unknown>)['type'],
    );
    expect(types).not.toContain('HERO');
    expect(types).not.toContain('PROMOTIONAL_BANNER');
  });

  it('carries the configured store name into the copy, per locale', async () => {
    const { client, upsert } = prismaStub(null);
    await seedDefaultHomeSections(client, DEMO);
    const trust = upsert.mock.calls
      .map(([args]) => args as Record<string, never>)
      .find((c) => (c['where'] as { id: string }).id === 'home-trust');
    const title = (trust?.['create'] as unknown as Record<string, unknown>)['title'] as Record<
      string,
      string
    >;
    const names = DEMO.identity.storeName as unknown as Record<string, string>;
    for (const locale of DEMO.localization.supportedLocales) {
      expect(title[locale], locale).toContain(names[locale] ?? names['default']);
    }
  });

  it('says something sensible when the store has no name yet', async () => {
    const { client, upsert } = prismaStub(null);
    await seedDefaultHomeSections(client, {
      ...NEUTRAL_STORE_CONFIG,
      identity: {
        ...NEUTRAL_STORE_CONFIG.identity,
        storeName: { default: '', fr: '', en: '' },
      },
    });
    const trust = upsert.mock.calls
      .map(([args]) => args as Record<string, never>)
      .find((c) => (c['where'] as { id: string }).id === 'home-trust');
    const title = (trust?.['create'] as unknown as Record<string, unknown>)['title'] as Record<
      string,
      string
    >;
    // Never a dangling "Why " with nothing after it.
    expect(title['default']).toBe('Why shop with us');
  });

  it('names the categories the showcase lists, as every reader of the row requires', async () => {
    // The API DTO, the admin schema and the storefront schema all require 1 to
    // 12 `categoryIds`, and the storefront never falls back to all categories.
    // A showcase planted without them failed the admin's sections list.
    const { client, upsert, findMany } = prismaStub(null);
    await seedDefaultHomeSections(client, DEMO);

    expect(plantedConfig(upsert, 'home-categories')['categoryIds']).toEqual(['cat-a', 'cat-b']);
    const query = findMany.mock.calls[0]?.[0] as { where: unknown; take: number };
    expect(query.where).toEqual({ parentId: null, isVisible: true, deletedAt: null });
    expect(query.take).toBe(12);
  });

  it('plants no category showcase when the store has no categories yet', async () => {
    const { client, upsert } = prismaStub(null, []);
    const result = await seedDefaultHomeSections(client, DEMO);

    const ids = upsert.mock.calls.map(([args]) => (args as { where: { id: string } }).where.id);
    expect(ids).toEqual(['home-featured', 'home-trust']);
    expect(result).toEqual({ planted: 2, skipped: false });
  });

  it('names the products the featured rail lists, as every reader of the row requires', async () => {
    // Same contract as the showcase: 1 to 12 `productIds` in the API DTO, the
    // admin schema and the storefront schema. A rail planted without them
    // failed the admin's sections list.
    const { client, upsert, findProducts } = prismaStub(null);
    await seedDefaultHomeSections(client, DEMO);

    const config = plantedConfig(upsert, 'home-featured');
    expect(config['productIds']).toEqual(['prod-a', 'prod-b']);
    expect(config['variant']).toBe('grid');
    const query = findProducts.mock.calls[0]?.[0] as { where: unknown; take: number };
    expect(query.where).toEqual({ isFeatured: true, status: 'ACTIVE', deletedAt: null });
    expect(query.take).toBe(12);
  });

  it('plants no featured rail when the store has marked no product featured', async () => {
    const { client, upsert } = prismaStub(null, CATEGORIES, []);
    const result = await seedDefaultHomeSections(client, DEMO);

    const ids = upsert.mock.calls.map(([args]) => (args as { where: { id: string } }).where.id);
    expect(ids).toEqual(['home-categories', 'home-trust']);
    expect(result).toEqual({ planted: 2, skipped: false });
  });

  it('leaves a home page somebody already built alone', async () => {
    const { client, upsert, findFirst } = prismaStub({ id: 'operator-hero' });
    const result = await seedDefaultHomeSections(client, DEMO);

    expect(result).toEqual({ planted: 0, skipped: true });
    expect(upsert).not.toHaveBeenCalled();
    // And it looks past its own rows: re-running must still reconcile them.
    const where = findFirst.mock.calls[0]?.[0]?.where as { id?: { notIn: string[] } };
    expect(where?.id?.notIn).toEqual([...DEFAULT_HOME_SECTION_IDS]);
  });
});
