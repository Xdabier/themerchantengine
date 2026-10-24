import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../shared/api-client.token';
import { UsersService } from './users.service';

const fakeUser = {
  id: 'u1',
  email: 'a@b.co',
  firstName: 'Jane',
  lastName: 'Doe',
};

const fakeAddress = {
  id: 'addr1',
  fullName: 'Jane Doe',
  phone: '+97412345678',
  addressLine1: '1 Main',
  city: 'Lyon',
  country: 'QA',
};

function mockClient(overrides: Partial<ApiClient>): ApiClient {
  return {
    get: vi.fn(async () => ({ data: fakeUser })),
    post: vi.fn(async () => ({ data: fakeAddress })),
    patch: vi.fn(async () => ({ data: fakeAddress })),
    delete: vi.fn(async () => undefined),
    request: vi.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

describe('UsersService', () => {
  it('getMe returns the parsed profile', async () => {
    const svc = new UsersService(mockClient({}));
    const user = await svc.getMe();
    expect(user.email).toBe('a@b.co');
  });

  it('getMe propagates API rejection from get()', async () => {
    const get = vi.fn(async () => {
      throw new Error('401 Unauthorized');
    }) as ApiClient['get'];
    const svc = new UsersService(mockClient({ get }));
    await expect(svc.getMe()).rejects.toThrow('401 Unauthorized');
  });

  it('updateMe rejects email change without currentPassword', async () => {
    const svc = new UsersService(mockClient({}));
    await expect(svc.updateMe({ email: 'b@c.co' })).rejects.toThrow();
  });

  it('updateMe accepts a name change', async () => {
    const patch = vi.fn(async () => ({ data: fakeUser })) as ApiClient['patch'];
    const svc = new UsersService(mockClient({ patch }));
    await svc.updateMe({ firstName: 'Janet' });
    expect(patch).toHaveBeenCalledWith('/v1/users/me', { firstName: 'Janet' });
  });

  it('createAddress validates country format', async () => {
    const svc = new UsersService(mockClient({}));
    await expect(
      svc.createAddress({
        fullName: 'J',
        phone: '+97412345678',
        addressLine1: '1 Main',
        city: 'Lyon',
        country: 'qa',
      } as never),
    ).rejects.toThrow();
  });

  it('createAddress posts to /v1/users/me/addresses', async () => {
    const post = vi.fn(async () => ({ data: fakeAddress })) as ApiClient['post'];
    const svc = new UsersService(mockClient({ post }));
    await svc.createAddress({
      fullName: 'Jane',
      phone: '+97412345678',
      addressLine1: '1 Main',
      city: 'Lyon',
      country: 'QA',
    });
    expect(post).toHaveBeenCalledWith(
      '/v1/users/me/addresses',
      expect.objectContaining({ country: 'QA' }),
    );
  });

  it('updateAddress patches the per-id path', async () => {
    const patch = vi.fn(async () => ({ data: fakeAddress })) as ApiClient['patch'];
    const svc = new UsersService(mockClient({ patch }));
    await svc.updateAddress('addr1', { city: 'Lusail' });
    expect(patch).toHaveBeenCalledWith('/v1/users/me/addresses/addr1', { city: 'Lusail' });
  });

  it('deleteAddress deletes the per-id path', async () => {
    const del = vi.fn(async () => undefined) as ApiClient['delete'];
    const svc = new UsersService(mockClient({ delete: del }));
    await svc.deleteAddress('addr1');
    expect(del).toHaveBeenCalledWith('/v1/users/me/addresses/addr1');
  });

  it('setDefaultAddress patches the default sub-path', async () => {
    const patch = vi.fn(async () => ({ data: fakeAddress })) as ApiClient['patch'];
    const svc = new UsersService(mockClient({ patch }));
    await svc.setDefaultAddress('addr1', { isDefaultShipping: true });
    expect(patch).toHaveBeenCalledWith(
      '/v1/users/me/addresses/addr1/default',
      expect.objectContaining({ isDefaultShipping: true }),
    );
  });
});
