import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../shared/api-client.token';
import { WishlistService } from './wishlist.service';

const fakeWishlistItem = {
  id: 'wl1',
  productId: 'p1',
  product: { id: 'p1', slug: 'h', name: 'H' },
  createdAt: '2026-04-25T10:00:00Z',
};

function mockClient(overrides: Partial<ApiClient>): ApiClient {
  return {
    get: vi.fn(async () => ({
      data: [fakeWishlistItem],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    })),
    post: vi.fn(async () => ({ data: fakeWishlistItem })),
    patch: vi.fn(),
    delete: vi.fn(async () => undefined),
    request: vi.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

describe('WishlistService', () => {
  it('list returns paginated wishlist items', async () => {
    const svc = new WishlistService(mockClient({}));
    const result = await svc.list({ sortBy: 'createdAt', sortOrder: 'desc' });
    expect(result.data).toHaveLength(1);
  });

  it('add POSTs to the per-product path', async () => {
    const post = vi.fn(async () => ({ data: fakeWishlistItem })) as ApiClient['post'];
    const svc = new WishlistService(mockClient({ post }));
    await svc.add('p1');
    expect(post).toHaveBeenCalledWith('/v1/wishlist/p1');
  });

  it('remove DELETEs the per-product path', async () => {
    const del = vi.fn(async () => undefined) as ApiClient['delete'];
    const svc = new WishlistService(mockClient({ delete: del }));
    await svc.remove('p1');
    expect(del).toHaveBeenCalledWith('/v1/wishlist/p1');
  });

  it('add rejects empty productId', async () => {
    const svc = new WishlistService(mockClient({}));
    await expect(svc.add('')).rejects.toThrow();
  });

  it('ids GETs the membership path and unwraps productIds', async () => {
    const get = vi.fn(async () => ({ data: { productIds: ['p1', 'p2'] } })) as ApiClient['get'];
    const svc = new WishlistService(mockClient({ get }));

    expect(await svc.ids()).toEqual(['p1', 'p2']);
    expect(get).toHaveBeenCalledWith('/v1/wishlist/ids');
  });

  it('ids rejects a payload that is not the declared envelope', async () => {
    const get = vi.fn(async () => ({ data: ['p1'] })) as ApiClient['get'];
    const svc = new WishlistService(mockClient({ get }));

    await expect(svc.ids()).rejects.toThrow();
  });
});
