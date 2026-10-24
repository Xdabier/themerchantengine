import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../shared/api-client.token';
import { SearchService } from './search.service';

function mockClient(overrides: Partial<ApiClient>): ApiClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
    ...overrides,
  } as ApiClient;
}

describe('SearchService.search', () => {
  it('returns paginated hits', async () => {
    const get = vi.fn(async () => ({
      data: [{ product: { id: 'p1', slug: 'h', name: 'H' } }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    })) as ApiClient['get'];
    const svc = new SearchService(mockClient({ get }));
    const result = await svc.search({ q: 'head' });
    expect(result.data[0].product.slug).toBe('h');
    expect(get).toHaveBeenCalledWith(
      '/v1/search',
      expect.objectContaining({ query: expect.objectContaining({ q: 'head' }) }),
    );
  });

  it('rejects invalid query', async () => {
    const svc = new SearchService(mockClient({ get: vi.fn() as ApiClient['get'] }));
    await expect(svc.search({ rating: 6 } as never)).rejects.toThrow();
  });
});

describe('SearchService.suggest', () => {
  it('returns suggestion list', async () => {
    const get = vi.fn(async () => ({ data: [{ label: 'headphones' }] })) as ApiClient['get'];
    const svc = new SearchService(mockClient({ get }));
    const result = await svc.suggest({ q: 'head' });
    expect(result).toHaveLength(1);
  });

  it('rejects empty q', async () => {
    const svc = new SearchService(mockClient({ get: vi.fn() as ApiClient['get'] }));
    await expect(svc.suggest({ q: '' } as never)).rejects.toThrow();
  });
});

describe('SearchService.filters', () => {
  it('returns filter buckets', async () => {
    const get = vi.fn(async () => ({
      data: [{ facet: 'brand', values: [{ value: 'Acme', count: 5 }] }],
    })) as ApiClient['get'];
    const svc = new SearchService(mockClient({ get }));
    const result = await svc.filters({ q: 'head' });
    expect(result[0].facet).toBe('brand');
  });
});

describe('SearchService.logClick / logConversion', () => {
  it('logClick posts to the eventId path', async () => {
    const post = vi.fn(async () => undefined) as ApiClient['post'];
    const svc = new SearchService(mockClient({ post }));
    await svc.logClick('evt1', { clickedProductId: 'p1', clickPosition: 0 });
    expect(post).toHaveBeenCalledWith(
      '/v1/search/events/evt1/click',
      expect.objectContaining({ clickedProductId: 'p1', clickPosition: 0 }),
      expect.anything(),
    );
  });

  // The card is a plain link, so the click unloads the page. WebKit aborts an
  // in-flight fetch on unload unless it is a keepalive request.
  it('logClick asks for a keepalive request so the page unload cannot abort it', async () => {
    const post = vi.fn(async () => undefined) as ApiClient['post'];
    const svc = new SearchService(mockClient({ post }));
    await svc.logClick('evt1', { clickedProductId: 'p1', clickPosition: 0 });
    expect(post).toHaveBeenCalledWith(
      '/v1/search/events/evt1/click',
      expect.anything(),
      expect.objectContaining({ keepalive: true }),
    );
  });

  it('logClick rejects empty eventId', async () => {
    const svc = new SearchService(mockClient({ post: vi.fn() as ApiClient['post'] }));
    await expect(svc.logClick('', { clickedProductId: 'p1', clickPosition: 0 })).rejects.toThrow();
  });

  it('logConversion posts with empty body', async () => {
    const post = vi.fn(async () => undefined) as ApiClient['post'];
    const svc = new SearchService(mockClient({ post }));
    await svc.logConversion('evt1');
    expect(post).toHaveBeenCalledWith('/v1/search/events/evt1/convert');
  });

  it('logConversion rejects empty eventId', async () => {
    const svc = new SearchService(mockClient({ post: vi.fn() as ApiClient['post'] }));
    await expect(svc.logConversion('')).rejects.toThrow();
  });
});
