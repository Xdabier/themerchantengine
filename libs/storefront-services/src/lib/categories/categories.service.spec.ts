import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../shared/api-client.token';
import { CategoriesService } from './categories.service';

function mockClient(get: ApiClient['get']): ApiClient {
  return {
    get,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  } as unknown as ApiClient;
}

describe('CategoriesService', () => {
  it('list returns the tree', async () => {
    const get = vi.fn(async () => ({
      data: [{ id: 'c1', slug: 'electronics', name: 'Electronics' }],
    })) as ApiClient['get'];
    const svc = new CategoriesService(mockClient(get));
    const result = await svc.list();
    expect(result).toHaveLength(1);
    expect(get).toHaveBeenCalledWith('/v1/categories', undefined);
  });

  it('list forwards the request options, so a caller can pin the locale', async () => {
    const get = vi.fn(async () => ({ data: [] })) as ApiClient['get'];
    const svc = new CategoriesService(mockClient(get));
    const headers = { 'Accept-Language': 'en', 'X-Locale': 'en' };
    await svc.list({ headers });
    expect(get).toHaveBeenCalledWith('/v1/categories', { headers });
  });

  it('getBySlug returns a single category', async () => {
    const get = vi.fn(async () => ({
      data: { id: 'c1', slug: 'electronics', name: 'Electronics', productCount: 5 },
    })) as ApiClient['get'];
    const svc = new CategoriesService(mockClient(get));
    const result = await svc.getBySlug('electronics');
    expect(result.slug).toBe('electronics');
    expect(get).toHaveBeenCalledWith('/v1/categories/electronics');
  });

  it('getBySlug rejects empty slug', async () => {
    const svc = new CategoriesService(mockClient(vi.fn() as ApiClient['get']));
    await expect(svc.getBySlug('')).rejects.toThrow();
  });

  it('listProducts paginates products under a slug', async () => {
    const get = vi.fn(async () => ({
      data: [{ id: 'p1', slug: 'h', name: 'H' }],
      meta: { page: 1, pageSize: 12, total: 1, totalPages: 1 },
    })) as ApiClient['get'];
    const svc = new CategoriesService(mockClient(get));
    const result = await svc.listProducts('electronics', { page: 1, pageSize: 12 });
    expect(result.data).toHaveLength(1);
    expect(get).toHaveBeenCalledWith(
      '/v1/categories/electronics/products',
      expect.objectContaining({ query: expect.objectContaining({ page: 1, pageSize: 12 }) }),
    );
  });

  it('listProducts rejects an invalid query', async () => {
    const svc = new CategoriesService(mockClient(vi.fn() as ApiClient['get']));
    await expect(svc.listProducts('electronics', { pageSize: 0 } as never)).rejects.toThrow();
  });
});
