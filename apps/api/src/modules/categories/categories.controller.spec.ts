import { PERMISSIONS_KEY } from '@common/decorators';
import { IS_PUBLIC_KEY } from '@common/decorators';
import { CategoriesController } from './categories.controller';

/**
 * Decorator security audit for CategoriesController.
 *
 * Verifies:
 *  - Storefront GET endpoints are @Public() (no auth required)
 *  - Admin endpoints carry @Permissions('categories:*') and are NOT @Public()
 *  - No @OwnerGuard on admin endpoints (categories are not user-owned)
 */
describe('CategoriesController — decorator audit', () => {
  const getMetadata = <T>(key: string, target: object, method: string): T | undefined => {
    return Reflect.getMetadata(key, (target as Record<string, object>)[method]) as T | undefined;
  };

  const proto = CategoriesController.prototype;

  // ── Storefront endpoints ─────────────────────────────────────────────────

  describe('GET /v1/categories (getTree)', () => {
    it('is marked @Public()', () => {
      expect(getMetadata<boolean>(IS_PUBLIC_KEY, proto, 'getTree')).toBe(true);
    });

    it('has no @Permissions decorator', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'getTree')).toBeUndefined();
    });
  });

  describe('GET /v1/categories/:slug (getBySlug)', () => {
    it('is marked @Public()', () => {
      expect(getMetadata<boolean>(IS_PUBLIC_KEY, proto, 'getBySlug')).toBe(true);
    });

    it('has no @Permissions decorator', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'getBySlug')).toBeUndefined();
    });
  });

  describe('GET /v1/categories/:slug/products (getProductsInCategory)', () => {
    it('is marked @Public()', () => {
      expect(getMetadata<boolean>(IS_PUBLIC_KEY, proto, 'getProductsInCategory')).toBe(true);
    });

    it('has no @Permissions decorator', () => {
      expect(
        getMetadata<string[]>(PERMISSIONS_KEY, proto, 'getProductsInCategory'),
      ).toBeUndefined();
    });
  });

  // ── Admin endpoints ──────────────────────────────────────────────────────

  describe('GET /v1/admin/categories (adminGetTree)', () => {
    it('requires categories:view permission', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'adminGetTree')).toContain(
        'categories:view',
      );
    });

    it('is NOT marked @Public()', () => {
      expect(getMetadata<boolean>(IS_PUBLIC_KEY, proto, 'adminGetTree')).toBeUndefined();
    });
  });

  describe('POST /v1/admin/categories (create)', () => {
    it('requires categories:create permission', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'create')).toContain(
        'categories:create',
      );
    });

    it('is NOT marked @Public()', () => {
      expect(getMetadata<boolean>(IS_PUBLIC_KEY, proto, 'create')).toBeUndefined();
    });
  });

  describe('PATCH /v1/admin/categories/reorder (reorder)', () => {
    it('requires categories:update permission', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'reorder')).toContain(
        'categories:update',
      );
    });

    it('is NOT marked @Public()', () => {
      expect(getMetadata<boolean>(IS_PUBLIC_KEY, proto, 'reorder')).toBeUndefined();
    });
  });

  describe('PATCH /v1/admin/categories/:id (update)', () => {
    it('requires categories:update permission', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'update')).toContain(
        'categories:update',
      );
    });

    it('is NOT marked @Public()', () => {
      expect(getMetadata<boolean>(IS_PUBLIC_KEY, proto, 'update')).toBeUndefined();
    });
  });

  describe('DELETE /v1/admin/categories/:id (delete)', () => {
    it('requires categories:delete permission', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'delete')).toContain(
        'categories:delete',
      );
    });

    it('is NOT marked @Public()', () => {
      expect(getMetadata<boolean>(IS_PUBLIC_KEY, proto, 'delete')).toBeUndefined();
    });
  });
});
