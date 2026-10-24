import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '@common/decorators';
import { PromotionsController } from './promotions.controller';

/**
 * Decorator security audit for PromotionsController.
 *
 * Verifies:
 *  - Storefront endpoints are @Public() and carry no permissions.
 *  - Admin read endpoint carries promotions:view.
 *  - Admin mutating endpoints carry granular promotions:* permissions.
 *  - No admin endpoint is @Public().
 */
describe('PromotionsController — decorator audit', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = PromotionsController.prototype as any;

  const getPermissions = (method: string): string[] | undefined =>
    Reflect.getMetadata(PERMISSIONS_KEY, proto[method] as object) as string[] | undefined;

  const isPublic = (method: string): boolean =>
    !!(Reflect.getMetadata(IS_PUBLIC_KEY, proto[method] as object) as boolean | undefined);

  // ── Storefront: @Public() ──────────────────────────────────────────────────

  describe('POST /v1/promotions/validate-coupon (validateCoupon)', () => {
    it('is @Public()', () => {
      expect(isPublic('validateCoupon')).toBe(true);
    });
    it('carries no admin permissions', () => {
      expect(getPermissions('validateCoupon')).toBeUndefined();
    });
  });

  describe('POST /v1/promotions/automatic (getApplicableAutomatic)', () => {
    it('is @Public()', () => {
      expect(isPublic('getApplicableAutomatic')).toBe(true);
    });
    it('carries no admin permissions', () => {
      expect(getPermissions('getApplicableAutomatic')).toBeUndefined();
    });
  });

  // ── Admin: read ────────────────────────────────────────────────────────────

  describe('GET /v1/admin/promotions (list)', () => {
    it('requires promotions:view', () => {
      expect(getPermissions('list')).toContain('promotions:view');
    });
    it('is NOT @Public()', () => {
      expect(isPublic('list')).toBe(false);
    });
  });

  // ── Admin: mutating ────────────────────────────────────────────────────────

  describe('POST /v1/admin/promotions (create)', () => {
    it('requires promotions:create', () => {
      expect(getPermissions('create')).toContain('promotions:create');
    });
    it('is NOT @Public()', () => {
      expect(isPublic('create')).toBe(false);
    });
  });

  describe('PATCH /v1/admin/promotions/:id (update)', () => {
    it('requires promotions:update', () => {
      expect(getPermissions('update')).toContain('promotions:update');
    });
    it('is NOT @Public()', () => {
      expect(isPublic('update')).toBe(false);
    });
  });

  describe('DELETE /v1/admin/promotions/:id (deactivate)', () => {
    it('requires promotions:delete', () => {
      expect(getPermissions('deactivate')).toContain('promotions:delete');
    });
    it('is NOT @Public()', () => {
      expect(isPublic('deactivate')).toBe(false);
    });
  });

  // ── Cross-cutting ──────────────────────────────────────────────────────────

  it('every admin endpoint carries a promotions:* permission', () => {
    const adminMethods: Array<[string, string]> = [
      ['list', 'promotions:view'],
      ['create', 'promotions:create'],
      ['update', 'promotions:update'],
      ['deactivate', 'promotions:delete'],
    ];
    for (const [method, permission] of adminMethods) {
      expect(getPermissions(method)).toContain(permission);
    }
  });

  it('no admin endpoint is @Public()', () => {
    for (const method of ['list', 'create', 'update', 'deactivate']) {
      expect(isPublic(method)).toBe(false);
    }
  });

  it('all storefront endpoints are @Public()', () => {
    for (const method of ['validateCoupon', 'getApplicableAutomatic']) {
      expect(isPublic(method)).toBe(true);
    }
  });
});
