import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../shared/api-client.token';
import { AnalyticsApiService } from './analytics.service';

function mockClient(post: ApiClient['post']): ApiClient {
  return {
    get: vi.fn(),
    post,
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  } as unknown as ApiClient;
}

describe('AnalyticsApiService', () => {
  it('posts the event to the public ingestion endpoint', async () => {
    const post = vi.fn(async () => undefined) as unknown as ApiClient['post'];
    const svc = new AnalyticsApiService(mockClient(post));

    await svc.send({ eventType: 'page_view', sessionId: 'abc_123', locale: 'fr' });

    expect(post).toHaveBeenCalledWith(
      '/v1/analytics/events',
      { eventType: 'page_view', sessionId: 'abc_123', locale: 'fr' },
      expect.anything(),
    );
  });

  it('sends the event as a keepalive request so a navigation cannot abort it', async () => {
    const post = vi.fn(async () => undefined) as unknown as ApiClient['post'];
    const svc = new AnalyticsApiService(mockClient(post));

    await svc.send({ eventType: 'page_view' });

    expect(post).toHaveBeenCalledWith('/v1/analytics/events', expect.anything(), {
      keepalive: true,
    });
  });

  it('drops a key the API would reject rather than sending it', async () => {
    // The global pipe runs forbidNonWhitelisted, so an unexpected key is a 400
    // and the whole event is lost. Stripping here keeps the event.
    const post = vi.fn(async () => undefined) as unknown as ApiClient['post'];
    const svc = new AnalyticsApiService(mockClient(post));

    await svc.send({ eventType: 'purchase', rogue: 'nope' } as never);

    expect(post).toHaveBeenCalledWith(
      '/v1/analytics/events',
      { eventType: 'purchase' },
      expect.anything(),
    );
  });

  it('throws on a malformed session id instead of posting a guaranteed 400', async () => {
    const post = vi.fn(async () => undefined) as unknown as ApiClient['post'];
    const svc = new AnalyticsApiService(mockClient(post));

    await expect(
      svc.send({ eventType: 'page_view', sessionId: 'not a session' }),
    ).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });

  it('throws on an event type the API does not accept', async () => {
    const post = vi.fn(async () => undefined) as unknown as ApiClient['post'];
    const svc = new AnalyticsApiService(mockClient(post));

    await expect(svc.send({ eventType: 'checkout_started' } as never)).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
});
