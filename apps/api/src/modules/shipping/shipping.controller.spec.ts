import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '@common/decorators';
import { ShippingController } from './shipping.controller';

/**
 * Decorator security audit for ShippingController.
 *
 * Verifies:
 *  - Storefront POST /shipping/rates is @Public()
 *  - All admin zone endpoints carry the correct @Permissions('shipping:*')
 *  - All admin method endpoints carry the correct @Permissions('shipping:*')
 *  - No admin endpoint is @Public()
 */
describe('ShippingController — decorator audit', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = ShippingController.prototype as any;

  const getPermissions = (method: string): string[] | undefined =>
    Reflect.getMetadata(PERMISSIONS_KEY, proto[method] as object) as string[] | undefined;

  const isPublic = (method: string): boolean =>
    !!(Reflect.getMetadata(IS_PUBLIC_KEY, proto[method] as object) as boolean | undefined);

  // ── Storefront ─────────────────────────────────────────────────────────────

  describe('POST /v1/shipping/rates (calculateRates)', () => {
    it('is @Public()', () => {
      expect(isPublic('calculateRates')).toBe(true);
    });
    it('has no @Permissions decorator', () => {
      expect(getPermissions('calculateRates')).toBeUndefined();
    });
  });

  // ── Admin zones: shipping:view ─────────────────────────────────────────────

  describe('GET /v1/admin/shipping/zones (listZones)', () => {
    it('requires shipping:view', () => {
      expect(getPermissions('listZones')).toContain('shipping:view');
    });
    it('is NOT @Public()', () => {
      expect(isPublic('listZones')).toBe(false);
    });
  });

  // ── Admin zones: shipping:create / shipping:update ─────────────────────────

  describe('POST /v1/admin/shipping/zones (createZone)', () => {
    it('requires shipping:create', () => {
      expect(getPermissions('createZone')).toContain('shipping:create');
    });
    it('is NOT @Public()', () => {
      expect(isPublic('createZone')).toBe(false);
    });
  });

  describe('PATCH /v1/admin/shipping/zones/:id (updateZone)', () => {
    it('requires shipping:update', () => {
      expect(getPermissions('updateZone')).toContain('shipping:update');
    });
    it('is NOT @Public()', () => {
      expect(isPublic('updateZone')).toBe(false);
    });
  });

  // ── Admin methods: shipping:view ───────────────────────────────────────────

  describe('GET /v1/admin/shipping/methods (listMethods)', () => {
    it('requires shipping:view', () => {
      expect(getPermissions('listMethods')).toContain('shipping:view');
    });
    it('is NOT @Public()', () => {
      expect(isPublic('listMethods')).toBe(false);
    });
  });

  // ── Admin methods: shipping:create / shipping:update / shipping:delete ─────

  describe('POST /v1/admin/shipping/methods (createMethod)', () => {
    it('requires shipping:create', () => {
      expect(getPermissions('createMethod')).toContain('shipping:create');
    });
    it('is NOT @Public()', () => {
      expect(isPublic('createMethod')).toBe(false);
    });
  });

  describe('PATCH /v1/admin/shipping/methods/:id (updateMethod)', () => {
    it('requires shipping:update', () => {
      expect(getPermissions('updateMethod')).toContain('shipping:update');
    });
    it('is NOT @Public()', () => {
      expect(isPublic('updateMethod')).toBe(false);
    });
  });

  describe('DELETE /v1/admin/shipping/methods/:id (deleteMethod)', () => {
    it('requires shipping:delete', () => {
      expect(getPermissions('deleteMethod')).toContain('shipping:delete');
    });
    it('is NOT @Public()', () => {
      expect(isPublic('deleteMethod')).toBe(false);
    });
  });

  // ── Cross-cutting: no admin endpoint is public ─────────────────────────────

  it('no admin endpoint exposes @Public()', () => {
    const adminMethods = [
      'listZones',
      'createZone',
      'updateZone',
      'listMethods',
      'createMethod',
      'updateMethod',
      'deleteMethod',
    ] as const;

    for (const method of adminMethods) {
      expect(isPublic(method)).toBe(false);
    }
  });

  it('every admin endpoint carries a shipping:* permission', () => {
    const adminMethods: Array<[string, string]> = [
      ['listZones', 'shipping:view'],
      ['createZone', 'shipping:create'],
      ['updateZone', 'shipping:update'],
      ['listMethods', 'shipping:view'],
      ['createMethod', 'shipping:create'],
      ['updateMethod', 'shipping:update'],
      ['deleteMethod', 'shipping:delete'],
    ];

    for (const [method, permission] of adminMethods) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[method] as object)).toContain(permission);
    }
  });
});
