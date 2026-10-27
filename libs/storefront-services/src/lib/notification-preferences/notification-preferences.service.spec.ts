import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../shared/api-client.token';
import { NotificationPreferencesService } from './notification-preferences.service';

const fakeMap = {
  LIFECYCLE: { email: true, sms: false, push: false },
  MARKETING: { email: false, sms: false, push: false },
};

function mockClient(overrides: Partial<ApiClient>): ApiClient {
  return {
    get: vi.fn(async () => ({ data: fakeMap })),
    post: vi.fn(),
    patch: vi.fn(async () => ({ data: fakeMap })),
    delete: vi.fn(),
    request: vi.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

describe('NotificationPreferencesService', () => {
  it('getPreferences returns the parsed consent map', async () => {
    const svc = new NotificationPreferencesService(mockClient({}));
    const map = await svc.getPreferences();
    expect(map.LIFECYCLE.email).toBe(true);
    expect(map.MARKETING.email).toBe(false);
  });

  it('getPreferences propagates an API rejection', async () => {
    const get = vi.fn(async () => {
      throw new Error('401 Unauthorized');
    }) as ApiClient['get'];
    const svc = new NotificationPreferencesService(mockClient({ get }));
    await expect(svc.getPreferences()).rejects.toThrow('401 Unauthorized');
  });

  it('updatePreferences PATCHes the validated partial payload', async () => {
    const patch = vi.fn(async () => ({ data: fakeMap })) as ApiClient['patch'];
    const svc = new NotificationPreferencesService(mockClient({ patch }));
    await svc.updatePreferences({ MARKETING: { email: true } });
    expect(patch).toHaveBeenCalledWith('/v1/users/me/notification-preferences', {
      MARKETING: { email: true },
    });
  });

  it('updatePreferences rejects an unknown category (strict schema)', async () => {
    const svc = new NotificationPreferencesService(mockClient({}));
    await expect(svc.updatePreferences({ PROMOS: { email: true } } as never)).rejects.toThrow();
  });
});
