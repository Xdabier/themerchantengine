import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../shared/api-client.token';
import { CartService } from './cart.service';

const emptyCart = { items: [], subtotal: 0, total: 0, currency: 'EUR' };

function cartWithItems(items: Array<{ id: string; quantity: number }>) {
  return {
    items: items.map((i) => ({
      id: i.id,
      productId: 'prd1',
      variantId: 'var1',
      productSlug: 'item',
      productName: 'Item',
      quantity: i.quantity,
      unitPrice: 100,
      lineTotal: 100 * i.quantity,
    })),
    subtotal: 0,
    total: 0,
    currency: 'EUR',
  };
}

function mockClient(overrides: Partial<ApiClient>): ApiClient {
  return {
    get: vi.fn(async () => ({ data: emptyCart })),
    post: vi.fn(async () => ({ data: emptyCart })),
    patch: vi.fn(async () => ({ data: emptyCart })),
    delete: vi.fn(async () => ({ data: emptyCart })),
    request: vi.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

describe('CartService.get', () => {
  it('returns the parsed cart', async () => {
    const svc = new CartService(mockClient({}));
    const cart = await svc.get();
    expect(cart.currency).toBe('EUR');
  });

  it('throws when shape mismatches', async () => {
    const svc = new CartService(
      mockClient({
        get: vi.fn(async () => ({
          data: { items: 'not-array', subtotal: 0, total: 0, currency: 'EUR' },
        })) as ApiClient['get'],
      }),
    );
    await expect(svc.get()).rejects.toThrow();
  });
});

describe('CartService.addItem', () => {
  it('posts the item and returns parsed cart', async () => {
    const post = vi.fn(async () => ({ data: emptyCart })) as ApiClient['post'];
    const svc = new CartService(mockClient({ post }));
    await svc.addItem({ variantId: 'v1', quantity: 2 });
    expect(post).toHaveBeenCalledWith('/v1/cart/items', { variantId: 'v1', quantity: 2 });
  });

  it('rejects qty 0', async () => {
    const svc = new CartService(mockClient({}));
    await expect(svc.addItem({ variantId: 'v1', quantity: 0 } as never)).rejects.toThrow();
  });
});

describe('CartService.updateItem', () => {
  it('patches the item path', async () => {
    const patch = vi.fn(async () => ({ data: emptyCart })) as ApiClient['patch'];
    const svc = new CartService(mockClient({ patch }));
    await svc.updateItem('it1', { quantity: 3 });
    expect(patch).toHaveBeenCalledWith('/v1/cart/items/it1', { quantity: 3 });
  });

  it('rejects empty itemId', async () => {
    const svc = new CartService(mockClient({}));
    await expect(svc.updateItem('', { quantity: 1 })).rejects.toThrow();
  });
});

describe('CartService.removeItem / clear', () => {
  it('removeItem deletes the path', async () => {
    const del = vi.fn(async () => ({ data: emptyCart })) as ApiClient['delete'];
    const svc = new CartService(mockClient({ delete: del }));
    await svc.removeItem('it1');
    expect(del).toHaveBeenCalledWith('/v1/cart/items/it1');
  });

  it('clear deletes /v1/cart', async () => {
    const del = vi.fn(async () => undefined) as ApiClient['delete'];
    const svc = new CartService(mockClient({ delete: del }));
    await svc.clear();
    expect(del).toHaveBeenCalledWith('/v1/cart');
  });
});

describe('CartService coupon + gift card', () => {
  it('applyCoupon validates code', async () => {
    const post = vi.fn(async () => ({ data: emptyCart })) as ApiClient['post'];
    const svc = new CartService(mockClient({ post }));
    await expect(svc.applyCoupon({ code: 'BAD CODE' } as never)).rejects.toThrow();
    await svc.applyCoupon({ code: 'SAVE10' });
    expect(post).toHaveBeenCalledWith('/v1/cart/coupon', { code: 'SAVE10' });
  });

  it('applyGiftCard validates 16-char code', async () => {
    const post = vi.fn(async () => ({ data: emptyCart })) as ApiClient['post'];
    const svc = new CartService(mockClient({ post }));
    await expect(svc.applyGiftCard({ code: 'short' } as never)).rejects.toThrow();
    await svc.applyGiftCard({ code: 'ABCD1234EFGH5678' });
    expect(post).toHaveBeenCalledWith('/v1/cart/gift-card', { code: 'ABCD1234EFGH5678' });
  });

  it('removeCoupon deletes the coupon endpoint', async () => {
    const del = vi.fn(async () => ({ data: emptyCart })) as ApiClient['delete'];
    const svc = new CartService(mockClient({ delete: del }));
    await svc.removeCoupon();
    expect(del).toHaveBeenCalledWith('/v1/cart/coupon');
  });
});

describe('CartService.itemCount signal', () => {
  it('seeds at 0 before any call', () => {
    const svc = new CartService(mockClient({}));
    expect(svc.itemCount()).toBe(0);
  });

  it('updates after get()', async () => {
    const svc = new CartService(
      mockClient({
        get: vi.fn(async () => ({
          data: cartWithItems([
            { id: 'a', quantity: 2 },
            { id: 'b', quantity: 1 },
          ]),
        })) as ApiClient['get'],
      }),
    );
    await svc.get();
    expect(svc.itemCount()).toBe(3);
  });

  it('updates after addItem / updateItem / removeItem', async () => {
    const post = vi.fn(async () => ({ data: cartWithItems([{ id: 'a', quantity: 3 }]) }));
    const patch = vi.fn(async () => ({ data: cartWithItems([{ id: 'a', quantity: 5 }]) }));
    const del = vi.fn(async () => ({ data: cartWithItems([{ id: 'a', quantity: 2 }]) }));
    const svc = new CartService(
      mockClient({
        post: post as ApiClient['post'],
        patch: patch as ApiClient['patch'],
        delete: del as ApiClient['delete'],
      }),
    );
    await svc.addItem({ variantId: 'v1', quantity: 3 });
    expect(svc.itemCount()).toBe(3);
    await svc.updateItem('a', { quantity: 5 });
    expect(svc.itemCount()).toBe(5);
    await svc.removeItem('a');
    expect(svc.itemCount()).toBe(2);
  });

  it('drops to 0 after clear()', async () => {
    const post = vi.fn(async () => ({ data: cartWithItems([{ id: 'a', quantity: 2 }]) }));
    const del = vi.fn(async () => undefined);
    const svc = new CartService(
      mockClient({
        post: post as ApiClient['post'],
        delete: del as ApiClient['delete'],
      }),
    );
    await svc.addItem({ variantId: 'v1', quantity: 2 });
    expect(svc.itemCount()).toBe(2);
    await svc.clear();
    expect(svc.itemCount()).toBe(0);
  });

  it('updates after coupon + gift-card mutations', async () => {
    const post = vi.fn(async () => ({ data: cartWithItems([{ id: 'a', quantity: 4 }]) }));
    const del = vi.fn(async () => ({ data: cartWithItems([{ id: 'a', quantity: 4 }]) }));
    const svc = new CartService(
      mockClient({
        post: post as ApiClient['post'],
        delete: del as ApiClient['delete'],
      }),
    );
    await svc.applyCoupon({ code: 'SAVE10' });
    expect(svc.itemCount()).toBe(4);
    await svc.removeCoupon();
    expect(svc.itemCount()).toBe(4);
    await svc.applyGiftCard({ code: 'ABCD1234EFGH5678' });
    expect(svc.itemCount()).toBe(4);
  });

  it('does not change after estimate or removeGiftCard', async () => {
    const post = vi.fn(async () => ({ data: cartWithItems([{ id: 'a', quantity: 2 }]) }));
    const get = vi.fn(async () => ({ data: { rates: [], taxEstimate: null } }));
    const del = vi.fn(async () => undefined);
    const svc = new CartService(
      mockClient({
        post: post as ApiClient['post'],
        get: get as ApiClient['get'],
        delete: del as ApiClient['delete'],
      }),
    );
    await svc.addItem({ variantId: 'v1', quantity: 2 });
    expect(svc.itemCount()).toBe(2);
    await svc.estimate({ country: 'TN', postalCode: '1002' });
    expect(svc.itemCount()).toBe(2);
    await svc.removeGiftCard();
    expect(svc.itemCount()).toBe(2);
  });
});

describe('CartService.estimate / saveForLater', () => {
  it('estimate sends country + postalCode', async () => {
    // The API returns an OBJECT, { rates, taxEstimate }, not a bare array. The
    // old fixture was an array and matched the old schema, which is how the
    // three-way mismatch with the real endpoint stayed invisible.
    const get = vi.fn(async () => ({ data: { rates: [], taxEstimate: null } })) as ApiClient['get'];
    const svc = new CartService(mockClient({ get }));
    await svc.estimate({ country: 'TN', postalCode: '1002' });
    expect(get).toHaveBeenCalledWith(
      '/v1/cart/estimate',
      expect.objectContaining({ query: { country: 'TN', postalCode: '1002' } }),
    );
  });

  it('saveForLater posts to the per-item path', async () => {
    const post = vi.fn(async () => ({ data: emptyCart })) as ApiClient['post'];
    const svc = new CartService(mockClient({ post }));
    await svc.saveForLater('it1');
    expect(post).toHaveBeenCalledWith('/v1/cart/items/it1/save-for-later');
  });
});

describe('CartService.merge', () => {
  it('posts to the merge endpoint with no body', async () => {
    const post = vi.fn(async () => ({ data: emptyCart })) as ApiClient['post'];
    const svc = new CartService(mockClient({ post }));
    await svc.merge();
    expect(post).toHaveBeenCalledWith('/v1/cart/merge');
  });

  it('syncs the badge from the merged cart, so the count is right in one round trip', async () => {
    const post = vi.fn(async () => ({
      data: cartWithItems([
        { id: 'i1', quantity: 2 },
        { id: 'i2', quantity: 1 },
      ]),
    })) as ApiClient['post'];
    const svc = new CartService(mockClient({ post }));
    expect(svc.itemCount()).toBe(0);
    await svc.merge();
    expect(svc.itemCount()).toBe(3);
  });

  it('rejects on a failure rather than swallowing it, so callers choose the policy', async () => {
    const post = vi.fn(async () => {
      throw new Error('boom');
    }) as ApiClient['post'];
    const svc = new CartService(mockClient({ post }));
    await expect(svc.merge()).rejects.toThrow('boom');
  });
});
