import {
  collectRolePermissions,
  fullName,
  groupPermissionsByModule,
  initials,
  moduleHint,
  moduleLabel,
  parsePermission,
  roleLabel,
  segmentTone,
  statusTone,
} from './users.utils';

describe('users utils', () => {
  describe('fullName', () => {
    it('joins first + last when present', () => {
      expect(fullName({ firstName: 'Ada', lastName: 'Lovelace', email: 'a@b' })).toBe(
        'Ada Lovelace',
      );
    });
    it('falls back to email when both blank', () => {
      expect(fullName({ firstName: null, lastName: null, email: 'a@b' })).toBe('a@b');
    });
  });

  describe('initials', () => {
    it('uses firstName + lastName letters', () => {
      expect(initials({ firstName: 'Ada', lastName: 'Lovelace', email: 'a@b' })).toBe('AL');
    });
    it('falls back to email prefix', () => {
      expect(initials({ firstName: null, lastName: null, email: 'xd@b' })).toBe('XD');
    });
  });

  describe('statusTone', () => {
    it('maps statuses', () => {
      expect(statusTone('active')).toBe('success');
      expect(statusTone('locked')).toBe('error');
      expect(statusTone('inactive')).toBe('warning');
    });
  });

  describe('segmentTone', () => {
    it('maps segments', () => {
      expect(segmentTone('VIP')).toBe('success');
      expect(segmentTone('AT_RISK')).toBe('warning');
      expect(segmentTone('CHURNED')).toBe('error');
      expect(segmentTone(null)).toBe('neutral');
    });
  });

  describe('roleLabel', () => {
    it('title-cases roles', () => {
      expect(roleLabel('ADMIN')).toBe('Admin');
      expect(roleLabel('MANAGER')).toBe('Manager');
    });
  });

  describe('collectRolePermissions', () => {
    it('accepts either shape', () => {
      const set = collectRolePermissions(['orders:view', { permission: 'orders:edit' }]);
      expect(set.has('orders:view')).toBe(true);
      expect(set.has('orders:edit')).toBe(true);
      expect(set.size).toBe(2);
    });
  });

  describe('parsePermission', () => {
    it('splits on colon', () => {
      expect(parsePermission('orders:view')).toEqual({ module: 'orders', action: 'view' });
    });
    it('rejects malformed strings', () => {
      expect(parsePermission('orders-view')).toBeNull();
    });
  });

  describe('groupPermissionsByModule', () => {
    it('groups + sorts module-then-action', () => {
      const grouped = groupPermissionsByModule([
        'orders:view',
        'products:view',
        'orders:create',
        'customers:manage',
      ]);
      expect(grouped.map((g) => g.module)).toEqual(['customers', 'orders', 'products']);
      expect(grouped.find((g) => g.module === 'orders')?.actions).toEqual(['create', 'view']);
    });
    it('drops malformed entries', () => {
      expect(groupPermissionsByModule(['bogus'])).toEqual([]);
    });
    it('carries a human label per group so the legend never prints the raw key', () => {
      const grouped = groupPermissionsByModule(['admin_users:view', 'gift_cards:view']);
      expect(grouped.map((g) => g.label)).toEqual(['Staff & Roles', 'Gift Cards']);
    });
  });

  describe('moduleLabel', () => {
    it('uses the curated label where the raw key would mislead', () => {
      expect(moduleLabel('admin_users')).toBe('Staff & Roles');
      expect(moduleLabel('storefront_config')).toBe('Storefront');
      expect(moduleLabel('cms')).toBe('CMS Pages');
    });
    it('keeps acronyms upper-case', () => {
      expect(moduleLabel('seo')).toBe('SEO');
      expect(moduleLabel('geo')).toBe('GEO');
    });
    it('falls back to humanizeCode for everything else', () => {
      expect(moduleLabel('gift_cards')).toBe('Gift Cards');
      expect(moduleLabel('payment_methods')).toBe('Payment Methods');
      expect(moduleLabel('orders')).toBe('Orders');
      expect(moduleLabel('settings')).toBe('Settings');
    });
  });

  describe('moduleHint', () => {
    it('explains the groups whose scope the name does not give away', () => {
      // Where the removed `currencies` / `tax` keys actually live.
      expect(moduleHint('settings')).toBe('Currencies, tax, countries, webhooks');
      expect(moduleHint('admin_users')).toBe('Gates both /staff and /roles');
    });
    it('is null for groups that need no explanation', () => {
      expect(moduleHint('orders')).toBeNull();
      expect(moduleHint('products')).toBeNull();
    });
    it('rides along on each group', () => {
      const grouped = groupPermissionsByModule(['settings:view', 'orders:view']);
      expect(grouped.find((g) => g.module === 'settings')?.hint).toBe(
        'Currencies, tax, countries, webhooks',
      );
      expect(grouped.find((g) => g.module === 'orders')?.hint).toBeNull();
    });
  });
});
