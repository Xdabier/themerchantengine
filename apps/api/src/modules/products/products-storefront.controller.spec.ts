import { PERMISSIONS_KEY, IS_PUBLIC_KEY } from '@common/decorators';
import { ProductsStorefrontController } from './products-storefront.controller';

/**
 * Decorator security audit for ProductsStorefrontController.
 *
 * Verifies:
 *  - Both storefront GET endpoints are @Public() with no @Permissions.
 *
 * Carved out of the original ProductsController spec when E4.B6 split the
 * controller into storefront + admin halves per constitution §3.5.
 */
describe('ProductsStorefrontController — decorator audit', () => {
  const getMetadata = <T>(key: string, target: object, method: string): T | undefined =>
    Reflect.getMetadata(key, (target as Record<string, object>)[method]) as T | undefined;

  const proto = ProductsStorefrontController.prototype;

  describe('GET /v1/products (listProducts)', () => {
    it('is @Public()', () => {
      expect(getMetadata<boolean>(IS_PUBLIC_KEY, proto, 'listProducts')).toBe(true);
    });
    it('has no @Permissions', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'listProducts')).toBeUndefined();
    });
  });

  describe('GET /v1/products/:slug (getProductBySlug)', () => {
    it('is @Public()', () => {
      expect(getMetadata<boolean>(IS_PUBLIC_KEY, proto, 'getProductBySlug')).toBe(true);
    });
    it('has no @Permissions', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'getProductBySlug')).toBeUndefined();
    });
  });
});
