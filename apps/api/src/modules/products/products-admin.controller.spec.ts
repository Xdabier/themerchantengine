import { PERMISSIONS_KEY, IS_PUBLIC_KEY } from '@common/decorators';
import { ProductsAdminController } from './products-admin.controller';

/**
 * Decorator security audit for ProductsAdminController.
 *
 * Verifies:
 *  - All admin endpoints carry the correct @Permissions('products:*')
 *  - No admin endpoint is @Public()
 *
 * Carved out of the original ProductsController spec when E4.B6 split the
 * controller into storefront + admin halves per constitution §3.5.
 */
describe('ProductsAdminController — decorator audit', () => {
  const getMetadata = <T>(key: string, target: object, method: string): T | undefined =>
    Reflect.getMetadata(key, (target as Record<string, object>)[method]) as T | undefined;

  const proto = ProductsAdminController.prototype;

  // ── Admin: Products ────────────────────────────────────────────────────────

  describe('GET /v1/admin/products (adminListProducts)', () => {
    it('requires products:view', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'adminListProducts')).toContain(
        'products:view',
      );
    });
    it('is NOT @Public()', () => {
      expect(getMetadata<boolean>(IS_PUBLIC_KEY, proto, 'adminListProducts')).toBeUndefined();
    });
  });

  describe('POST /v1/admin/products (createProduct)', () => {
    it('requires products:create', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'createProduct')).toContain(
        'products:create',
      );
    });
    it('is NOT @Public()', () => {
      expect(getMetadata<boolean>(IS_PUBLIC_KEY, proto, 'createProduct')).toBeUndefined();
    });
  });

  describe('GET /v1/admin/products/:id (adminGetProduct)', () => {
    it('requires products:view', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'adminGetProduct')).toContain(
        'products:view',
      );
    });
  });

  describe('PATCH /v1/admin/products/:id (updateProduct)', () => {
    it('requires products:update', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'updateProduct')).toContain(
        'products:update',
      );
    });
    it('is NOT @Public()', () => {
      expect(getMetadata<boolean>(IS_PUBLIC_KEY, proto, 'updateProduct')).toBeUndefined();
    });
  });

  describe('DELETE /v1/admin/products/:id (deleteProduct)', () => {
    it('requires products:delete', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'deleteProduct')).toContain(
        'products:delete',
      );
    });
  });

  describe('PATCH /v1/admin/products/:id/restore (restoreProduct)', () => {
    it('requires products:update', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'restoreProduct')).toContain(
        'products:update',
      );
    });
  });

  // ── Admin: Variants ────────────────────────────────────────────────────────

  describe('POST /v1/admin/products/:id/variants (createVariant)', () => {
    it('requires products:create', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'createVariant')).toContain(
        'products:create',
      );
    });
  });

  describe('PATCH /v1/admin/products/:id/variants/:variantId (updateVariant)', () => {
    it('requires products:update', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'updateVariant')).toContain(
        'products:update',
      );
    });
  });

  describe('DELETE /v1/admin/products/:id/variants/:variantId (deleteVariant)', () => {
    it('requires products:delete', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'deleteVariant')).toContain(
        'products:delete',
      );
    });
  });

  // ── Admin: Assets ──────────────────────────────────────────────────────────

  describe('PATCH /v1/admin/products/:id/assets (updateAssets)', () => {
    it('requires products:update', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'updateAssets')).toContain(
        'products:update',
      );
    });
  });

  // ── Admin: FAQs ────────────────────────────────────────────────────────────

  describe('POST /v1/admin/products/:id/faqs (createFaq)', () => {
    it('requires products:create', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'createFaq')).toContain(
        'products:create',
      );
    });
  });

  describe('PATCH /v1/admin/products/:id/faqs/:faqId (updateFaq)', () => {
    it('requires products:update', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'updateFaq')).toContain(
        'products:update',
      );
    });
  });

  describe('DELETE /v1/admin/products/:id/faqs/:faqId (deleteFaq)', () => {
    it('requires products:delete', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'deleteFaq')).toContain(
        'products:delete',
      );
    });
  });

  // ── Admin: Bulk ────────────────────────────────────────────────────────────

  describe('PATCH /v1/admin/products/bulk/prices (bulkUpdatePrices)', () => {
    it('requires products:update', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'bulkUpdatePrices')).toContain(
        'products:update',
      );
    });
    it('is NOT @Public()', () => {
      expect(getMetadata<boolean>(IS_PUBLIC_KEY, proto, 'bulkUpdatePrices')).toBeUndefined();
    });
  });

  describe('PATCH /v1/admin/products/bulk/status (bulkUpdateStatus)', () => {
    it('requires products:update', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'bulkUpdateStatus')).toContain(
        'products:update',
      );
    });
  });

  // ── Admin: Product Types ───────────────────────────────────────────────────

  describe('GET /v1/admin/product-types (listProductTypes)', () => {
    it('requires products:view', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'listProductTypes')).toContain(
        'products:view',
      );
    });
  });

  describe('POST /v1/admin/product-types (createProductType)', () => {
    it('requires products:create', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'createProductType')).toContain(
        'products:create',
      );
    });
  });

  describe('PATCH /v1/admin/product-types/:id (updateProductType)', () => {
    it('requires products:update', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'updateProductType')).toContain(
        'products:update',
      );
    });
  });

  describe('DELETE /v1/admin/product-types/:id (deleteProductType)', () => {
    it('requires products:delete', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'deleteProductType')).toContain(
        'products:delete',
      );
    });
  });

  // ── Admin: Attributes ──────────────────────────────────────────────────────

  describe('GET /v1/admin/attributes (listAttributes)', () => {
    it('requires products:view', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'listAttributes')).toContain(
        'products:view',
      );
    });
  });

  describe('POST /v1/admin/attributes (createAttribute)', () => {
    it('requires products:create', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'createAttribute')).toContain(
        'products:create',
      );
    });
  });

  describe('PATCH /v1/admin/attributes/:id (updateAttribute)', () => {
    it('requires products:update', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'updateAttribute')).toContain(
        'products:update',
      );
    });
  });

  describe('DELETE /v1/admin/attributes/:id (deleteAttribute)', () => {
    it('requires products:delete', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'deleteAttribute')).toContain(
        'products:delete',
      );
    });
  });

  describe('POST /v1/admin/attributes/:id/values (createAttributeValue)', () => {
    it('requires products:create', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'createAttributeValue')).toContain(
        'products:create',
      );
    });
  });

  describe('PATCH /v1/admin/attributes/:id/values/:valueId (updateAttributeValue)', () => {
    it('requires products:update', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'updateAttributeValue')).toContain(
        'products:update',
      );
    });
  });

  describe('DELETE /v1/admin/attributes/:id/values/:valueId (deleteAttributeValue)', () => {
    it('requires products:delete', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'deleteAttributeValue')).toContain(
        'products:delete',
      );
    });
  });
});
