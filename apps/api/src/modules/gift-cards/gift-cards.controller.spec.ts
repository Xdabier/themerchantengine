import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '@common/decorators';
import { GiftCardsController } from './gift-cards.controller';

/**
 * Decorator security audit for GiftCardsController.
 *
 * Verifies:
 *  - GET /gift-cards/balance (checkBalance) is @Public() with no permissions.
 *  - No customer-facing purchase route exists at all (DR-30).
 *  - Admin read endpoints carry gift_cards:view.
 *  - Admin mutating endpoint carries gift_cards:create / gift_cards:update.
 *  - No admin endpoint is @Public().
 */
describe('GiftCardsController — decorator audit', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = GiftCardsController.prototype as any;

  const getPermissions = (method: string): string[] | undefined =>
    Reflect.getMetadata(PERMISSIONS_KEY, proto[method] as object) as string[] | undefined;

  const isPublic = (method: string): boolean =>
    !!(Reflect.getMetadata(IS_PUBLIC_KEY, proto[method] as object) as boolean | undefined);

  // ── Storefront: balance check (public) ────────────────────────────────────

  describe('GET /v1/gift-cards/balance (checkBalance)', () => {
    it('is @Public()', () => {
      expect(isPublic('checkBalance')).toBe(true);
    });

    it('carries no admin permissions', () => {
      expect(getPermissions('checkBalance')).toBeUndefined();
    });
  });

  // ── Storefront: the mint is closed (DR-30) ────────────────────────────────

  describe('customer-facing gift-card minting', () => {
    /**
     * `POST /v1/gift-cards/purchase` created a card worth whatever
     * `initialBalance` the request body named, with no payment captured and no
     * order attached. Asserting the absence of a handler is the whole point
     * here, so the sibling assertions below establish that this reflection
     * actually sees the controller's methods: an absence check over an object
     * that resolves to nothing passes for the wrong reason.
     */
    it('has no purchase handler on the controller', () => {
      expect(Object.getOwnPropertyNames(proto)).not.toContain('purchase');
      expect(proto['purchase']).toBeUndefined();
    });

    it('and the reflection above is looking at a real controller', () => {
      const handlers = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
      expect(handlers.length).toBeGreaterThan(5);
      expect(handlers).toContain('checkBalance');
    });

    it('leaves issuance to the admin surface, behind a permission', () => {
      expect(getPermissions('issue')).toContain('gift_cards:create');
      expect(isPublic('issue')).toBe(false);
    });
  });

  // ── Admin: read ────────────────────────────────────────────────────────────

  describe('GET /v1/admin/gift-cards (list)', () => {
    it('requires gift_cards:view', () => {
      expect(getPermissions('list')).toContain('gift_cards:view');
    });

    it('is NOT @Public()', () => {
      expect(isPublic('list')).toBe(false);
    });
  });

  describe('GET /v1/admin/gift-cards/:id (findOne)', () => {
    it('requires gift_cards:view', () => {
      expect(getPermissions('findOne')).toContain('gift_cards:view');
    });

    it('is NOT @Public()', () => {
      expect(isPublic('findOne')).toBe(false);
    });
  });

  // ── Admin: mutating ────────────────────────────────────────────────────────

  describe('POST /v1/admin/gift-cards (issue)', () => {
    it('requires gift_cards:create', () => {
      expect(getPermissions('issue')).toContain('gift_cards:create');
    });

    it('is NOT @Public()', () => {
      expect(isPublic('issue')).toBe(false);
    });
  });

  describe('PATCH /v1/admin/gift-cards/:id (update)', () => {
    it('requires gift_cards:update', () => {
      expect(getPermissions('update')).toContain('gift_cards:update');
    });

    it('is NOT @Public()', () => {
      expect(isPublic('update')).toBe(false);
    });
  });

  // ── Cross-cutting ──────────────────────────────────────────────────────────

  it('every admin endpoint carries a gift_cards:* permission', () => {
    const adminMethods: Array<[string, string]> = [
      ['list', 'gift_cards:view'],
      ['issue', 'gift_cards:create'],
      ['findOne', 'gift_cards:view'],
      ['update', 'gift_cards:update'],
    ];
    for (const [method, permission] of adminMethods) {
      expect(getPermissions(method)).toContain(permission);
    }
  });

  it('no admin endpoint is @Public()', () => {
    for (const method of ['list', 'issue', 'findOne', 'update']) {
      expect(isPublic(method)).toBe(false);
    }
  });
});
