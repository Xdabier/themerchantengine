import { IS_PUBLIC_KEY, OWNER_GUARD_KEY, PERMISSIONS_KEY } from '@common/decorators';
import { IS_OPTIONAL_AUTH_KEY } from '@common/decorators/optional-auth.decorator';
import { CartController } from './cart.controller';
import { SESSION_COOKIE_NAME } from './cart.constants';

/**
 * Decorator security audit for CartController.
 *
 * Verifies:
 *  - @OptionalAuth() is applied at class level (supports anonymous + authenticated carts).
 *  - No storefront endpoint carries @Permissions() (cart is storefront-only, no admin routes).
 *  - No endpoint overrides with @Public() (session tracking requires optional-auth, not full bypass).
 *  - save-for-later endpoint is the only one with special auth requirements (handled at service layer).
 */
describe('CartController — decorator audit', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = CartController.prototype as any;

  const getPermissions = (method: string): string[] | undefined =>
    Reflect.getMetadata(PERMISSIONS_KEY, proto[method]) as string[] | undefined;

  const isPublic = (method: string): boolean =>
    !!(Reflect.getMetadata(IS_PUBLIC_KEY, proto[method]) as boolean | undefined);

  const hasOwnerGuard = (method: string): boolean =>
    !!(Reflect.getMetadata(OWNER_GUARD_KEY, proto[method]) as boolean | undefined);

  // ── Class-level @OptionalAuth() ───────────────────────────────────────────

  it('has @OptionalAuth() at class level (supports both anonymous and authenticated users)', () => {
    const meta = Reflect.getMetadata(IS_OPTIONAL_AUTH_KEY, CartController);
    expect(meta).toBe(true);
  });

  it('does NOT have @Public() at class level', () => {
    const meta = Reflect.getMetadata(IS_PUBLIC_KEY, CartController);
    expect(meta).toBeUndefined();
  });

  // ── No admin @Permissions() on any handler ────────────────────────────────

  const handlers = [
    'getCart',
    'addItem',
    'updateItem',
    'removeItem',
    'clearCart',
    'applyCoupon',
    'removeCoupon',
    'applyGiftCard',
    'removeGiftCard',
    'estimateShipping',
    'saveForLater',
    'mergeCart',
  ];

  it('no cart endpoint carries admin @Permissions()', () => {
    for (const handler of handlers) {
      expect(getPermissions(handler)).toBeUndefined();
    }
  });

  // ── No handler overrides to @Public() ─────────────────────────────────────

  it('no cart endpoint is @Public() (optional-auth is used at class level instead)', () => {
    for (const handler of handlers) {
      expect(isPublic(handler)).toBe(false);
    }
  });

  // ── Method-level checks ───────────────────────────────────────────────────

  describe('GET /v1/cart (getCart)', () => {
    it('carries no admin permissions', () => {
      expect(getPermissions('getCart')).toBeUndefined();
    });
    it('is not @Public()', () => {
      expect(isPublic('getCart')).toBe(false);
    });
  });

  describe('POST /v1/cart/items (addItem)', () => {
    it('carries no admin permissions', () => {
      expect(getPermissions('addItem')).toBeUndefined();
    });
  });

  describe('POST /v1/cart/coupon (applyCoupon)', () => {
    it('carries no admin permissions', () => {
      expect(getPermissions('applyCoupon')).toBeUndefined();
    });
  });

  describe('POST /v1/cart/gift-card (applyGiftCard)', () => {
    it('carries no admin permissions', () => {
      expect(getPermissions('applyGiftCard')).toBeUndefined();
    });
  });

  describe('POST /v1/cart/items/:itemId/save-for-later (saveForLater)', () => {
    it('carries no admin permissions (auth enforced at service layer)', () => {
      expect(getPermissions('saveForLater')).toBeUndefined();
    });
    it('is not @Public() (requires active user check in handler)', () => {
      expect(isPublic('saveForLater')).toBe(false);
    });
    it('carries @OwnerGuard() — per-customer storefront write (audit §1.13 WARN)', () => {
      expect(hasOwnerGuard('saveForLater')).toBe(true);
    });
  });

  // ── @OwnerGuard() scope: only authenticated-only routes carry it ──────────
  // The @OptionalAuth() class decorator means most cart routes serve anon
  // requests; applying @OwnerGuard() to them would trip OWNER_GUARD_USER_MISSING
  // on every anonymous request. Only save-for-later (@RequireAuth()) opts in.

  it('only the authenticated-only routes carry @OwnerGuard() (anon-serving routes intentionally omit it)', () => {
    const authOnly = new Set(['saveForLater', 'mergeCart']);
    for (const handler of handlers.filter((h) => !authOnly.has(h))) {
      expect(hasOwnerGuard(handler)).toBe(false);
    }
    for (const handler of authOnly) {
      expect(hasOwnerGuard(handler)).toBe(true);
    }
  });

  // ── POST /v1/cart/merge (mergeCart) ───────────────────────────────────────
  //
  // The anonymous cart cookie is HttpOnly, so browser JS cannot read it and
  // cannot hand the session id to the server. The merge therefore has to be an
  // authenticated endpoint that reads the cookie itself, which is why it takes
  // the save-for-later decoration rather than the class-level optional auth.
  describe('POST /v1/cart/merge (mergeCart)', () => {
    it('carries no admin permissions', () => {
      expect(getPermissions('mergeCart')).toBeUndefined();
    });
    it('is not @Public()', () => {
      expect(isPublic('mergeCart')).toBe(false);
    });
    it('carries @OwnerGuard() — per-customer storefront write', () => {
      expect(hasOwnerGuard('mergeCart')).toBe(true);
    });
  });
});

/**
 * Behaviour of the merge handler (plan F phase F2, findings K4 and pass-2 A9).
 *
 * `CartService.mergeAnonymousCart` has been written, unit-tested and unreachable
 * since the Better Auth cutover deleted its only caller: signing in silently
 * dropped the guest basket and its coupon. These cases pin the seam the
 * endpoint adds around it.
 */
describe('CartController — POST /v1/cart/merge', () => {
  function makeService() {
    return {
      mergeAnonymousCart: jest.fn().mockResolvedValue(undefined),
      getCart: jest.fn().mockResolvedValue({ items: [], itemCount: 0 }),
    };
  }

  function makeReq(cookies?: Record<string, string>) {
    return { user: { id: 'user-1' }, cookies } as never;
  }

  function makeRes() {
    return { clearCookie: jest.fn(), cookie: jest.fn() } as never;
  }

  it('merges the cookie session into the signed-in user cart', async () => {
    const service = makeService();
    const controller = new CartController(service as never);
    const res = makeRes();
    await controller.mergeCart(makeReq({ [SESSION_COOKIE_NAME]: 'sess-abc' }), res);
    expect(service.mergeAnonymousCart).toHaveBeenCalledWith('user-1', 'sess-abc');
  });

  it('clears the anonymous cookie once the cart has been claimed', async () => {
    const service = makeService();
    const controller = new CartController(service as never);
    const res = makeRes();
    await controller.mergeCart(makeReq({ [SESSION_COOKIE_NAME]: 'sess-abc' }), res);
    expect((res as unknown as { clearCookie: jest.Mock }).clearCookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      expect.objectContaining({ path: '/' }),
    );
  });

  it('returns the merged cart so the badge updates in one round trip', async () => {
    const service = makeService();
    service.getCart.mockResolvedValue({ items: [{ id: 'i1' }], itemCount: 3 });
    const controller = new CartController(service as never);
    const cart = await controller.mergeCart(
      makeReq({ [SESSION_COOKIE_NAME]: 'sess-abc' }),
      makeRes(),
    );
    expect(service.getCart).toHaveBeenCalledWith('user-1', undefined);
    expect((cart as { itemCount: number }).itemCount).toBe(3);
  });

  it('is a no-op with no anonymous cookie, and does NOT mint a session id', async () => {
    // `identity()` mints a fresh session id when the cookie is absent, which is
    // right for a cart read and wrong here: merging against an invented id
    // would be a pointless serializable transaction on every single sign-in.
    const service = makeService();
    const controller = new CartController(service as never);
    const res = makeRes();
    await controller.mergeCart(makeReq(undefined), res);
    expect(service.mergeAnonymousCart).not.toHaveBeenCalled();
    expect((res as unknown as { clearCookie: jest.Mock }).clearCookie).not.toHaveBeenCalled();
  });

  it('still answers with the user cart when there was nothing to merge', async () => {
    const service = makeService();
    const controller = new CartController(service as never);
    const cart = await controller.mergeCart(makeReq(undefined), makeRes());
    expect(service.getCart).toHaveBeenCalledWith('user-1', undefined);
    expect(cart).toBeDefined();
  });
});

/**
 * The anonymous cart session id is a bearer credential.
 *
 * It was minted from `Math.random()` back when the worst case was "a stranger
 * sees a cart". Plan F phase F3 promoted the same value to the only key to a
 * placed guest order: shipping address, phone, email, line items, totals. That
 * changed what the generator has to be.
 *
 * `Math.random()` is xorshift128+, not a CSPRNG. Its internal state is
 * recoverable from a handful of observed outputs, and outputs are freely
 * observable because any anonymous `POST /v1/cart/items` returns a fresh
 * `Set-Cookie: sessionId=...` to an unauthenticated caller. `HttpOnly` does not
 * help: it stops JavaScript reading the cookie, not an attacker sending one.
 */
describe('CartController — anonymous session id', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mint = (): string => (CartController.prototype as any).newSessionId.call(null);

  it('carries at least 128 bits of entropy', () => {
    // base64url of 32 bytes is 43 characters. Anything materially shorter is
    // not a credential.
    expect(mint().length).toBeGreaterThanOrEqual(32);
  });

  it('is not derived from the clock', () => {
    // The canary for the old implementation, which embedded `Date.now()` and
    // so leaked most of its own value to anyone who knew roughly when the
    // cookie was minted.
    const now = String(Date.now());
    const stamp = now.slice(0, 10);
    for (let i = 0; i < 50; i++) {
      expect(mint()).not.toContain(stamp);
    }
  });

  it('never repeats across a large batch', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i++) ids.add(mint());
    expect(ids.size).toBe(5000);
  });

  it('shares no common prefix between consecutive mints', () => {
    // Two `Math.random()` ids minted in the same millisecond agreed on their
    // first ~19 characters. A CSPRNG's do not.
    const a = mint();
    const b = mint();
    let shared = 0;
    while (shared < a.length && a[shared] === b[shared]) shared++;
    expect(shared).toBeLessThan(4);
  });

  it('is URL-safe, so it survives a cookie round trip unescaped', () => {
    expect(mint()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
