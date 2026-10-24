import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../shared/api-client.token';
import { ReviewsService } from './reviews.service';

const fakeReview = {
  id: 'r1',
  productId: 'p1',
  rating: 5,
  body: 'great',
  helpfulCount: 0,
  status: 'PUBLISHED',
  createdAt: '2026-04-25T10:00:00Z',
};

function mockClient(overrides: Partial<ApiClient>): ApiClient {
  return {
    get: vi.fn(async () => ({ data: fakeReview })),
    post: vi.fn(async () => ({ data: fakeReview })),
    patch: vi.fn(async () => ({ data: fakeReview })),
    delete: vi.fn(async () => undefined),
    request: vi.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

describe('ReviewsService.list / create / summary', () => {
  it('list returns paginated reviews under a product slug', async () => {
    const get = vi.fn(async () => ({
      data: [fakeReview],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    })) as ApiClient['get'];
    const svc = new ReviewsService(mockClient({ get }));
    await svc.list('headphones', { rating: 5 });
    expect(get).toHaveBeenCalledWith(
      '/v1/products/headphones/reviews',
      expect.objectContaining({ query: expect.objectContaining({ rating: 5 }) }),
    );
  });

  it('create posts to the per-slug reviews path', async () => {
    const post = vi.fn(async () => ({ data: fakeReview })) as ApiClient['post'];
    const svc = new ReviewsService(mockClient({ post }));
    await svc.create('headphones', { rating: 5, body: 'great' });
    expect(post).toHaveBeenCalledWith(
      '/v1/products/headphones/reviews',
      expect.objectContaining({ rating: 5 }),
    );
  });

  it('create rejects body > 5000 chars', async () => {
    const svc = new ReviewsService(mockClient({}));
    await expect(svc.create('h', { rating: 5, body: 'x'.repeat(5001) })).rejects.toThrow();
  });

  it('summary returns rating summary', async () => {
    const get = vi.fn(async () => ({
      data: { averageRating: 4.5, total: 12 },
    })) as ApiClient['get'];
    const svc = new ReviewsService(mockClient({ get }));
    const result = await svc.summary('headphones');
    expect(result.total).toBe(12);
  });
});

describe('ReviewsService.mine', () => {
  it('GETs the own-review path and parses the row', async () => {
    const get = vi.fn(async () => ({
      data: { ...fakeReview, status: 'PENDING' },
    })) as ApiClient['get'];
    const svc = new ReviewsService(mockClient({ get }));

    const own = await svc.mine('headphones');

    expect(get).toHaveBeenCalledWith('/v1/products/headphones/reviews/mine');
    expect(own?.status).toBe('PENDING');
  });

  it('returns null when the caller has no review', async () => {
    const get = vi.fn(async () => ({ data: null })) as ApiClient['get'];
    const svc = new ReviewsService(mockClient({ get }));

    await expect(svc.mine('headphones')).resolves.toBeNull();
  });
});

describe('ReviewsService.eligibility', () => {
  it('GETs the eligibility path and parses the verdict', async () => {
    const get = vi.fn(async () => ({
      data: { eligible: false, reason: 'VERIFIED_PURCHASE_REQUIRED' },
    })) as ApiClient['get'];
    const svc = new ReviewsService(mockClient({ get }));

    const verdict = await svc.eligibility('headphones');

    expect(get).toHaveBeenCalledWith('/v1/products/headphones/reviews/eligibility');
    expect(verdict).toEqual({ eligible: false, reason: 'VERIFIED_PURCHASE_REQUIRED' });
  });

  it('rejects a reason the API does not declare', async () => {
    const get = vi.fn(async () => ({
      data: { eligible: false, reason: 'BECAUSE' },
    })) as ApiClient['get'];
    const svc = new ReviewsService(mockClient({ get }));

    await expect(svc.eligibility('headphones')).rejects.toThrow();
  });
});

describe('ReviewsService.update / delete / toggleHelpful', () => {
  it('update PATCHes the review path', async () => {
    const patch = vi.fn(async () => ({ data: fakeReview })) as ApiClient['patch'];
    const svc = new ReviewsService(mockClient({ patch }));
    await svc.update('r1', { rating: 4 });
    expect(patch).toHaveBeenCalledWith('/v1/reviews/r1', { rating: 4 });
  });

  it('delete DELETEs the review path', async () => {
    const del = vi.fn(async () => undefined) as ApiClient['delete'];
    const svc = new ReviewsService(mockClient({ delete: del }));
    await svc.delete('r1');
    expect(del).toHaveBeenCalledWith('/v1/reviews/r1');
  });

  it('toggleHelpful POSTs to the helpful path + parses helpful flag', async () => {
    const post = vi.fn(async () => ({ data: { helpful: true } })) as ApiClient['post'];
    const svc = new ReviewsService(mockClient({ post }));
    const result = await svc.toggleHelpful('r1');
    expect(post).toHaveBeenCalledWith('/v1/reviews/r1/helpful');
    expect(result.helpful).toBe(true);
  });
});
