import { PERMISSION_ACTIONS, PERMISSION_MODULES, PERMISSION_STRINGS } from '@permissions';
import {
  DEAD_PERMISSION_MODULES,
  PERMISSION_TWINS,
  assertCatalogueIntegrity,
} from '../../../prisma/reconcile-role-permissions';

/**
 * Static guards for the data migration that deletes RolePermission rows on the
 * live database during every deploy. The behavioural half runs against a real
 * database in `test/e2e/role-permissions.e2e-spec.ts`.
 */
describe('role permission reconcile', () => {
  it('accepts the current catalogue', () => {
    expect(() => assertCatalogueIntegrity()).not.toThrow();
  });

  it('never deletes a module the api enforces', () => {
    const canonical = new Set<string>(PERMISSION_MODULES);
    for (const dead of DEAD_PERMISSION_MODULES) {
      expect(canonical.has(dead)).toBe(false);
    }
  });

  it('bounds the delete to the eleven historical dead families', () => {
    expect(DEAD_PERMISSION_MODULES).toHaveLength(11);
    const doomed = DEAD_PERMISSION_MODULES.flatMap((mod) =>
      PERMISSION_ACTIONS.map((action) => `${mod}:${action}`),
    );
    expect(doomed).toHaveLength(55);
    // The two sets must not overlap, or a deploy would delete a live grant.
    const catalogue = new Set<string>(PERMISSION_STRINGS);
    expect(doomed.filter((p) => catalogue.has(p))).toEqual([]);
  });

  it('maps every twin onto a real module, and lists the twin as dead', () => {
    for (const [twin, canonical] of Object.entries(PERMISSION_TWINS)) {
      expect(PERMISSION_MODULES).toContain(canonical);
      expect(DEAD_PERMISSION_MODULES).toContain(twin);
    }
  });

  it('leaves the eight non-twin dead keys unmapped on purpose', () => {
    // Auto-mapping `tax:view` to `settings:view` or `staff:view` to
    // `admin_users:view` would grant far more than the operator ticked.
    const unmapped = DEAD_PERMISSION_MODULES.filter((mod) => !(mod in PERMISSION_TWINS));
    expect([...unmapped].sort()).toEqual([
      'currencies',
      'license',
      'rbac',
      'refunds',
      'roles',
      'staff',
      'tax',
      'users',
    ]);
  });
});
