import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { WishlistService } from '@storefront-services';
import type { CustomerUser } from '@storefront-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthStateService } from './auth-state.service';
import { WishlistStateService } from './wishlist-state.service';

const SHOPPER: CustomerUser = {
  id: 'user-1',
  email: 'shopper@example.test',
  firstName: 'Shop',
  lastName: 'Per',
  phone: null,
  avatarUrl: null,
  locale: 'fr',
  addresses: [],
};

function makeUser(): CustomerUser {
  return SHOPPER;
}

function makeWishlistApi(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ids: vi.fn(async () => ['p1', 'p2']),
    list: vi.fn(async () => ({ data: [], meta: { page: 1, pageSize: 20, total: 0 } })),
    add: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    ...overrides,
  };
}

function configure(api: ReturnType<typeof makeWishlistApi>, platform = 'browser') {
  TestBed.configureTestingModule({
    providers: [
      AuthStateService,
      WishlistStateService,
      { provide: WishlistService, useValue: api },
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  return {
    auth: TestBed.inject(AuthStateService),
    state: TestBed.inject(WishlistStateService),
  };
}

describe('WishlistStateService', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('hydrates the membership set from the ids endpoint once the customer is authed', async () => {
    const api = makeWishlistApi();
    const { auth, state } = configure(api);

    auth.setSession({ user: makeUser() });
    TestBed.tick();
    await Promise.resolve();

    expect(api.ids).toHaveBeenCalledTimes(1);
    // The heavy list endpoint pays for a product join, an asset join and an
    // inventory grading call to answer one bit per product.
    expect(api.list).not.toHaveBeenCalled();
    expect(state.isWishlisted('p1')).toBe(true);
    expect(state.isWishlisted('nope')).toBe(false);
  });

  it('never hydrates on the server pass', async () => {
    const api = makeWishlistApi();
    const { auth } = configure(api, 'server');

    auth.setSession({ user: makeUser() });
    TestBed.tick();
    await Promise.resolve();

    expect(api.ids).not.toHaveBeenCalled();
  });

  it('empties the set on sign-out', async () => {
    const api = makeWishlistApi();
    const { auth, state } = configure(api);

    auth.setSession({ user: makeUser() });
    TestBed.tick();
    await Promise.resolve();
    expect(state.isWishlisted('p1')).toBe(true);

    auth.clearSession();
    TestBed.tick();

    expect(state.isWishlisted('p1')).toBe(false);
  });

  it('add inserts optimistically and calls the API', async () => {
    const api = makeWishlistApi({ ids: vi.fn(async () => []) });
    const { state } = configure(api);

    const pending = state.add('p9');
    expect(state.isWishlisted('p9')).toBe(true);
    await pending;

    expect(api.add).toHaveBeenCalledWith('p9');
  });

  it('add reverts and rethrows when the API rejects', async () => {
    const boom = new Error('nope');
    const api = makeWishlistApi({
      ids: vi.fn(async () => []),
      add: vi.fn(async () => {
        throw boom;
      }),
    });
    const { state } = configure(api);

    await expect(state.add('p9')).rejects.toBe(boom);
    expect(state.isWishlisted('p9')).toBe(false);
  });

  it('remove drops optimistically and reverts on rejection', async () => {
    const boom = new Error('nope');
    const api = makeWishlistApi({
      remove: vi.fn(async () => {
        throw boom;
      }),
    });
    const { auth, state } = configure(api);

    auth.setSession({ user: makeUser() });
    TestBed.tick();
    await Promise.resolve();

    await expect(state.remove('p1')).rejects.toBe(boom);
    expect(state.isWishlisted('p1')).toBe(true);
  });

  // A stale set is worse than an empty one: it renders a filled heart for a
  // product the customer no longer has.
  it('leaves the set empty when hydration fails, without throwing', async () => {
    const api = makeWishlistApi({
      ids: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const { auth, state } = configure(api);

    auth.setSession({ user: makeUser() });
    TestBed.tick();
    await Promise.resolve();
    await Promise.resolve();

    expect(state.isWishlisted('p1')).toBe(false);
  });

  it('re-reads the server rather than guessing after an out-of-band change', async () => {
    const api = makeWishlistApi();
    const { auth, state } = configure(api);

    auth.setSession({ user: makeUser() });
    TestBed.tick();
    await Promise.resolve();

    api.ids.mockResolvedValueOnce(['p1', 'p2', 'p3']);
    await state.hydrate();

    expect(state.isWishlisted('p3')).toBe(true);
  });
});
