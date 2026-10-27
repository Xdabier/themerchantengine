import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../shared/api-client.token';
import { ReturnsService } from './returns.service';

const fakeReturn = {
  id: 'ret1',
  orderId: 'ord1',
  status: 'REQUESTED',
  reason: 'DEFECTIVE',
  items: [{ orderItemId: 'oi1', quantity: 1 }],
  createdAt: '2026-04-25T10:00:00Z',
};

function mockClient(overrides: Partial<ApiClient>): ApiClient {
  return {
    get: vi.fn(async () => ({ data: fakeReturn })),
    post: vi.fn(async () => ({ data: fakeReturn })),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

describe('ReturnsService.create', () => {
  it('posts to the per-order returns path', async () => {
    const post = vi.fn(async () => ({ data: fakeReturn })) as ApiClient['post'];
    const svc = new ReturnsService(mockClient({ post }));
    await svc.create('ord1', {
      items: [{ orderItemId: 'oi1', quantity: 1 }],
      reason: 'DEFECTIVE',
    });
    expect(post).toHaveBeenCalledWith(
      '/v1/orders/ord1/returns',
      expect.objectContaining({ reason: 'DEFECTIVE' }),
    );
  });

  it('rejects EXCHANGE without exchangeVariantId on each item', async () => {
    const svc = new ReturnsService(mockClient({}));
    await expect(
      svc.create('ord1', {
        items: [{ orderItemId: 'oi1', quantity: 1 }],
        reason: 'WRONG_SIZE',
        refundMethod: 'EXCHANGE',
      }),
    ).rejects.toThrow();
  });
});

describe('ReturnsService.list / getById', () => {
  it('list returns paginated returns', async () => {
    const get = vi.fn(async () => ({
      data: [fakeReturn],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    })) as ApiClient['get'];
    const svc = new ReturnsService(mockClient({ get }));
    const result = await svc.list();
    expect(result.data).toHaveLength(1);
  });

  it('getById returns a single return', async () => {
    const get = vi.fn(async () => ({ data: fakeReturn })) as ApiClient['get'];
    const svc = new ReturnsService(mockClient({ get }));
    const result = await svc.getById('ret1');
    expect(result.id).toBe('ret1');
    expect(get).toHaveBeenCalledWith('/v1/returns/ret1');
  });
});
