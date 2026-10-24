import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '@common/decorators';
import { TaxController } from './tax.controller';

/**
 * Decorator security audit for TaxController.
 *
 * Verifies:
 *  - Read-only endpoints carry settings:view
 *  - Mutating endpoints carry settings:manage
 *  - No endpoint is @Public()
 */
describe('TaxController — decorator audit', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = TaxController.prototype as any;

  const getPermissions = (method: string): string[] | undefined =>
    Reflect.getMetadata(PERMISSIONS_KEY, proto[method] as object) as string[] | undefined;

  const isPublic = (method: string): boolean =>
    !!(Reflect.getMetadata(IS_PUBLIC_KEY, proto[method] as object) as boolean | undefined);

  // ── Read-only: settings:view ───────────────────────────────────────────────

  describe('GET /v1/admin/tax/zones (listZones)', () => {
    it('requires settings:view', () => {
      expect(getPermissions('listZones')).toContain('settings:view');
    });
    it('is NOT @Public()', () => {
      expect(isPublic('listZones')).toBe(false);
    });
  });

  describe('GET /v1/admin/tax/classes (listClasses)', () => {
    it('requires settings:view', () => {
      expect(getPermissions('listClasses')).toContain('settings:view');
    });
    it('is NOT @Public()', () => {
      expect(isPublic('listClasses')).toBe(false);
    });
  });

  // ── Mutating: settings:manage ──────────────────────────────────────────────

  describe('POST /v1/admin/tax/zones (createZone)', () => {
    it('requires settings:manage', () => {
      expect(getPermissions('createZone')).toContain('settings:manage');
    });
    it('is NOT @Public()', () => {
      expect(isPublic('createZone')).toBe(false);
    });
  });

  describe('PATCH /v1/admin/tax/zones/:id (updateZone)', () => {
    it('requires settings:manage', () => {
      expect(getPermissions('updateZone')).toContain('settings:manage');
    });
    it('is NOT @Public()', () => {
      expect(isPublic('updateZone')).toBe(false);
    });
  });

  describe('POST /v1/admin/tax/classes (createClass)', () => {
    it('requires settings:manage', () => {
      expect(getPermissions('createClass')).toContain('settings:manage');
    });
    it('is NOT @Public()', () => {
      expect(isPublic('createClass')).toBe(false);
    });
  });

  // ── Cross-cutting: no endpoint is public ───────────────────────────────────

  it('no endpoint is @Public()', () => {
    const allMethods = ['listZones', 'createZone', 'updateZone', 'listClasses', 'createClass'];
    for (const method of allMethods) {
      expect(isPublic(method)).toBe(false);
    }
  });

  it('every endpoint carries correct settings:* permission', () => {
    const cases: Array<[string, string]> = [
      ['listZones', 'settings:view'],
      ['createZone', 'settings:manage'],
      ['updateZone', 'settings:manage'],
      ['listClasses', 'settings:view'],
      ['createClass', 'settings:manage'],
    ];

    for (const [method, permission] of cases) {
      expect(getPermissions(method)).toContain(permission);
    }
  });
});
