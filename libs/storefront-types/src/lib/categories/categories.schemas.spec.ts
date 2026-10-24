import { describe, expect, it } from 'vitest';
import {
  categoryDetailSchema,
  categorySchema,
  listCategoriesResponseSchema,
  listCategoryProductsQuerySchema,
} from './categories.schemas';

describe('categorySchema', () => {
  it('parses a flat category', () => {
    expect(() =>
      categorySchema.parse({
        id: 'cat1',
        slug: 'electronics',
        name: { default: 'Électronique', fr: 'Électronique', en: 'Electronics' },
      }),
    ).not.toThrow();
  });

  it('parses a category with children', () => {
    expect(() =>
      categorySchema.parse({
        id: 'cat1',
        slug: 'electronics',
        name: 'Electronics',
        children: [{ id: 'cat2', slug: 'audio', name: 'Audio' }],
      }),
    ).not.toThrow();
  });

  it('rejects an invalid slug shape', () => {
    expect(() => categorySchema.parse({ id: 'cat1', slug: 1, name: 'x' })).toThrow();
  });
});

describe('listCategoriesResponseSchema', () => {
  it('parses an array of categories', () => {
    expect(() =>
      listCategoriesResponseSchema.parse([
        { id: 'a', slug: 'a', name: 'A' },
        { id: 'b', slug: 'b', name: 'B' },
      ]),
    ).not.toThrow();
  });

  it('rejects a non-array', () => {
    expect(() => listCategoriesResponseSchema.parse({ id: 'a', slug: 'a', name: 'A' })).toThrow();
  });
});

describe('categoryDetailSchema', () => {
  it('parses a detail payload', () => {
    expect(() =>
      categoryDetailSchema.parse({
        id: 'cat1',
        slug: 'electronics',
        name: 'Electronics',
        productCount: 42,
      }),
    ).not.toThrow();
  });
});

describe('listCategoryProductsQuerySchema', () => {
  it('accepts pagination params', () => {
    expect(() => listCategoryProductsQuerySchema.parse({ page: 1, pageSize: 24 })).not.toThrow();
  });

  it('rejects pageSize 0', () => {
    expect(() => listCategoryProductsQuerySchema.parse({ pageSize: 0 })).toThrow();
  });
});
