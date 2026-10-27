import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../shared/api-client.token';
import { ProductsService } from './products.service';

function mockClient(get: ApiClient['get']): ApiClient {
  return {
    get,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  } as unknown as ApiClient;
}

describe('ProductsService.list', () => {
  it('returns parsed data + meta', async () => {
    const get = vi.fn(async () => ({
      data: [{ id: 'p1', slug: 'h', name: 'H' }],
      meta: { page: 1, pageSize: 1, total: 1, totalPages: 1 },
    })) as ApiClient['get'];
    const svc = new ProductsService(mockClient(get));
    const result = await svc.list({ page: 1, pageSize: 1 });
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
    expect(get).toHaveBeenCalledWith(
      '/v1/products',
      expect.objectContaining({ query: expect.objectContaining({ page: 1, pageSize: 1 }) }),
    );
  });

  it('rejects an invalid query', async () => {
    const svc = new ProductsService(mockClient(vi.fn() as ApiClient['get']));
    await expect(svc.list({ minPrice: -1 } as never)).rejects.toThrow();
  });

  it('throws when response is missing meta', async () => {
    const get = vi.fn(async () => ({ data: [] })) as ApiClient['get'];
    const svc = new ProductsService(mockClient(get));
    await expect(svc.list()).rejects.toThrow();
  });
});

describe('ProductsService.getBySlug', () => {
  it('returns the parsed detail payload', async () => {
    const get = vi.fn(async () => ({
      data: {
        id: 'p1',
        slug: 'h',
        name: 'H',
        variants: [],
        assets: [],
        faqs: [],
        categories: [],
      },
    })) as ApiClient['get'];
    const svc = new ProductsService(mockClient(get));
    const result = await svc.getBySlug('h');
    expect(result.slug).toBe('h');
    expect(get).toHaveBeenCalledWith('/v1/products/h');
  });

  it('rejects an empty slug', async () => {
    const svc = new ProductsService(mockClient(vi.fn() as ApiClient['get']));
    await expect(svc.getBySlug('')).rejects.toThrow();
  });
});

/**
 * Finding C11 (plan L Phase L5). Brand facets come from the catalogue, not from
 * the products on screen, so the rail keeps every brand after one is selected.
 */
describe('ProductsService.brandFacets', () => {
  it('parses the facet list and forwards a category scope', async () => {
    const get = vi.fn(async () => ({
      data: [
        { brand: 'Nike', count: 2 },
        { brand: 'H&M', count: 1 },
      ],
    })) as ApiClient['get'];
    const svc = new ProductsService(mockClient(get));
    const facets = await svc.brandFacets('cat-1');
    expect(facets).toEqual([
      { brand: 'Nike', count: 2 },
      { brand: 'H&M', count: 1 },
    ]);
    expect(get).toHaveBeenCalledWith('/v1/products/brands', { query: { categoryId: 'cat-1' } });
  });

  it('sends no query when no category is given', async () => {
    const get = vi.fn(async () => ({ data: [] })) as ApiClient['get'];
    const svc = new ProductsService(mockClient(get));
    await svc.brandFacets();
    expect(get).toHaveBeenCalledWith('/v1/products/brands', { query: {} });
  });

  /**
   * Secondary content: losing the rail must never cost the catalogue its grid,
   * so a malformed or failed response degrades to no brands rather than
   * throwing into the page.
   */
  it('degrades to an empty list on a malformed payload', async () => {
    const get = vi.fn(async () => ({ data: [{ brand: 'Nike' }] })) as ApiClient['get'];
    const svc = new ProductsService(mockClient(get));
    await expect(svc.brandFacets()).resolves.toEqual([]);
  });

  it('degrades to an empty list when the endpoint fails', async () => {
    const get = vi.fn(async () => {
      throw new Error('down');
    }) as ApiClient['get'];
    const svc = new ProductsService(mockClient(get));
    await expect(svc.brandFacets()).resolves.toEqual([]);
  });
});
