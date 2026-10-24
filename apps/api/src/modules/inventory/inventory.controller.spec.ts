import { PERMISSIONS_KEY } from '@common/decorators';
import { InventoryController } from './inventory.controller';

/**
 * Decorator security audit for InventoryController.
 *
 * Verifies:
 *  - All admin endpoints carry the correct @Permissions('inventory:*')
 *  - No endpoint is @Public()
 *  - Read-only endpoints use 'inventory:view'
 *  - Mutating endpoints use granular 'inventory:update', 'inventory:create', 'inventory:delete'
 */
describe('InventoryController — decorator audit', () => {
  const getMetadata = <T>(key: string, target: object, method: string): T | undefined =>
    Reflect.getMetadata(key, (target as Record<string, object>)[method]) as T | undefined;

  const proto = InventoryController.prototype;

  // ── Read-only: inventory:view ──────────────────────────────────────────────

  describe('GET /v1/admin/inventory (listStockLevels)', () => {
    it('requires inventory:view', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'listStockLevels')).toContain(
        'inventory:view',
      );
    });
    it('is NOT @Public()', () => {
      expect(Reflect.getMetadata('isPublic', proto['listStockLevels'])).toBeUndefined();
    });
  });

  describe('GET /v1/admin/inventory/variant/:variantId (getVariantStock)', () => {
    it('requires inventory:view', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'getVariantStock')).toContain(
        'inventory:view',
      );
    });
  });

  describe('GET /v1/admin/inventory/movements (listMovements)', () => {
    it('requires inventory:view', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'listMovements')).toContain(
        'inventory:view',
      );
    });
  });

  describe('GET /v1/admin/inventory/locations (listLocations)', () => {
    it('requires inventory:view', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'listLocations')).toContain(
        'inventory:view',
      );
    });
  });

  // ── Mutating: granular inventory permissions ───────────────────────────────

  describe('PATCH /v1/admin/inventory/adjust (adjustInventory)', () => {
    it('requires inventory:update', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'adjustInventory')).toContain(
        'inventory:update',
      );
    });
    it('is NOT @Public()', () => {
      expect(Reflect.getMetadata('isPublic', proto['adjustInventory'])).toBeUndefined();
    });
  });

  describe('POST /v1/admin/inventory/transfer (transferInventory)', () => {
    it('requires inventory:update', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'transferInventory')).toContain(
        'inventory:update',
      );
    });
  });

  describe('POST /v1/admin/inventory/locations (createLocation)', () => {
    it('requires inventory:create', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'createLocation')).toContain(
        'inventory:create',
      );
    });
    it('is NOT @Public()', () => {
      expect(Reflect.getMetadata('isPublic', proto['createLocation'])).toBeUndefined();
    });
  });

  describe('PATCH /v1/admin/inventory/locations/:id (updateLocation)', () => {
    it('requires inventory:update', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'updateLocation')).toContain(
        'inventory:update',
      );
    });
  });

  describe('DELETE /v1/admin/inventory/locations/:id (deleteLocation)', () => {
    it('requires inventory:delete', () => {
      expect(getMetadata<string[]>(PERMISSIONS_KEY, proto, 'deleteLocation')).toContain(
        'inventory:delete',
      );
    });
    it('is NOT @Public()', () => {
      expect(Reflect.getMetadata('isPublic', proto['deleteLocation'])).toBeUndefined();
    });
  });
});
