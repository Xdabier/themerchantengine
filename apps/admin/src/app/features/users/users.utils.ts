import type { BadgeTone } from '@admin-ui';
import type { AdminUser } from '@admin-types';
import type {
  Customer,
  CustomerSegment,
  ListStaffRole,
  StaffMember,
  StaffRole,
} from '@admin-services';
import { labelFromMap } from '../../shared/format/enum-label';

export function fullName(user: Pick<AdminUser, 'firstName' | 'lastName' | 'email'>): string {
  const first = user.firstName ?? '';
  const last = user.lastName ?? '';
  const combined = `${first} ${last}`.trim();
  return combined.length > 0 ? combined : user.email;
}

export function initials(user: Pick<AdminUser, 'firstName' | 'lastName' | 'email'>): string {
  const first = user.firstName?.[0] ?? '';
  const last = user.lastName?.[0] ?? '';
  const combined = `${first}${last}`.trim();
  if (combined.length > 0) return combined.toUpperCase();
  // Fall back to the first two characters of the local-part so the avatar
  // tile is never empty when names are missing.
  const local = user.email.split('@')[0];
  return (local.slice(0, 2) || '??').toUpperCase();
}

export function statusTone(status: AdminUser['status'] | undefined): BadgeTone {
  switch (status) {
    case 'active':
      return 'success';
    case 'locked':
      return 'error';
    case 'inactive':
      return 'warning';
    default:
      return 'neutral';
  }
}

/** Friendly, Title-Cased label for the AdminUser/Customer status enum. */
export function statusLabel(status: AdminUser['status'] | undefined): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'inactive':
      return 'Inactive';
    case 'locked':
      return 'Locked';
    default:
      return '—';
  }
}

export function segmentTone(segment: CustomerSegment | null | undefined): BadgeTone {
  switch (segment) {
    case 'VIP':
    case 'HIGH_VALUE':
    case 'LOYAL':
      return 'success';
    case 'ACTIVE':
    case 'NEW':
      return 'info';
    case 'AT_RISK':
      return 'warning';
    case 'CHURNED':
      return 'error';
    default:
      return 'neutral';
  }
}

export function segmentLabel(segment: CustomerSegment): string {
  return segment
    .toLowerCase()
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

const ROLE_LABELS: Record<ListStaffRole, string> = {
  SUPER_ADMIN: 'Super admin',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  SUPPORT: 'Support',
};

export function roleLabel(role: ListStaffRole | StaffRole | null | undefined): string {
  return labelFromMap(ROLE_LABELS, role as ListStaffRole | null | undefined);
}

/**
 * ROLES cell for a staff row: the base role, plus the custom role name when the
 * account carries one (e.g. `Admin · Catalog editor`). The column used to bind
 * `roles[]`, which the staff response never sends, so every row dashed.
 */
export function staffRolesLabel(staff: StaffMember): string {
  const base = staff.role ? roleLabel(staff.role) : null;
  const custom = staff.customRole?.name ?? null;
  const parts = [base, custom].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/**
 * Collapses a role's permissions[] (which can be strings or
 * `{permission}` join rows) into a stable `Set<string>`.
 */
export function collectRolePermissions(
  permissions: ReadonlyArray<string | { permission: string }>,
): Set<string> {
  const out = new Set<string>();
  for (const p of permissions) {
    out.add(typeof p === 'string' ? p : p.permission);
  }
  return out;
}

/** `customer:view` → `{ module: 'customer', action: 'view' }`. */
export function parsePermission(raw: string): { module: string; action: string } | null {
  const [module, action] = raw.split(':');
  if (!module || !action) return null;
  return { module, action };
}

/**
 * Curated headings for the role grid. Only the modules whose raw key would
 * mislead an operator are listed; everything else reads fine through
 * `humanizeCode` (`gift_cards` → "Gift Cards"). The keys themselves never
 * change, they stay in testids and aria ids.
 */
const MODULE_LABELS: Record<string, string> = {
  // Names the key it actually gates, since the screens are /staff and /roles.
  admin_users: 'Staff & Roles',
  audit_log: 'Audit Log',
  cms: 'CMS Pages',
  seo: 'SEO',
  geo: 'GEO',
  storefront_config: 'Storefront',
};

/**
 * Second line for the few groups whose scope is not obvious from the name.
 * Kept out of the legend: that is an uppercase, letter-spaced eyebrow, and a
 * sentence set that way is hard to read.
 */
const MODULE_HINTS: Record<string, string> = {
  // Where the removed `currencies` and `tax` keys actually live.
  settings: 'Currencies, tax, countries, webhooks',
  admin_users: 'Gates both /staff and /roles',
};

export function moduleLabel(module: string): string {
  return labelFromMap(MODULE_LABELS, module);
}

export function moduleHint(module: string): string | null {
  return MODULE_HINTS[module] ?? null;
}

/** Group a flat permission list by module for the role editor grid. */
export function groupPermissionsByModule(
  all: readonly string[],
): Array<{ module: string; label: string; hint: string | null; actions: string[] }> {
  const map = new Map<string, string[]>();
  for (const raw of all) {
    const parsed = parsePermission(raw);
    if (!parsed) continue;
    const list = map.get(parsed.module) ?? [];
    list.push(parsed.action);
    map.set(parsed.module, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, actions]) => ({
      module,
      label: moduleLabel(module),
      hint: moduleHint(module),
      actions: actions.sort(),
    }));
}

export function customerLabel(customer: Customer): string {
  return fullName(customer);
}
