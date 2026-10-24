import type { NavGroup, NavItem } from '@admin-ui';

/**
 * Admin dashboard navigation.
 * Mirrors `specs/admin-dashboard/screen-inventory.md` route-by-route.
 * Items with no `permission` show for all authenticated users.
 * Permission strings are the canonical backend form (`module:action` with
 * underscores) — `docs/site/reference/permissions.md`.
 * Items whose owning phase has not shipped carry `hidden: true`; the owning
 * phase flips the flag when the routes land.
 */
export const navConfig: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', to: '/', permission: 'analytics:view' },
      { label: 'Analytics', to: '/analytics', permission: 'analytics:view' },
    ],
  },
  {
    label: 'Commerce',
    items: [
      { label: 'Orders', to: '/orders', permission: 'orders:view' },
      { label: 'Returns', to: '/returns', permission: 'returns:view' },
      { label: 'Customers', to: '/customers', permission: 'customers:view' },
      { label: 'Segments', to: '/customers/segments', permission: 'customers:view' },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { label: 'Products', to: '/products', permission: 'products:view' },
      { label: 'Categories', to: '/categories', permission: 'categories:view' },
      { label: 'Assets', to: '/assets', permission: 'assets:view' },
      { label: 'Storefront', to: '/storefront', permission: 'storefront_config:view' },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { label: 'Promotions', to: '/promotions', permission: 'promotions:view' },
      { label: 'Gift cards', to: '/gift-cards', permission: 'gift_cards:view' },
      { label: 'Inbox', to: '/notifications/inbox', permission: 'notifications:view' },
      {
        label: 'Notification templates',
        to: '/notifications/templates',
        permission: 'notifications:view',
      },
      { label: 'Send log', to: '/notifications/log', permission: 'notifications:view' },
      { label: 'Campaigns', to: '/campaigns', permission: 'campaigns:view' },
      { label: 'Subscribers', to: '/subscribers', permission: 'campaigns:view' },
      { label: 'Pages', to: '/pages', permission: 'cms:view' },
      { label: 'SEO', to: '/seo/redirects', permission: 'seo:view' },
      { label: 'SEO indexing', to: '/seo/indexing', permission: 'seo:view' },
      { label: 'SEO health', to: '/seo/health', permission: 'seo:view' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Payments', to: '/payment-methods', permission: 'payment_methods:view' },
      { label: 'Checkout settings', to: '/checkout-settings', permission: 'checkout:view' },
      { label: 'Inventory', to: '/inventory', permission: 'inventory:view' },
      { label: 'Shipping', to: '/shipping/carriers', permission: 'carriers:view' },
      { label: 'Shipping zones', to: '/shipping/zones', permission: 'shipping:view' },
      { label: 'Shipping methods', to: '/shipping/methods', permission: 'shipping:view' },
      { label: 'Countries', to: '/shipping/countries', permission: 'settings:view' },
      { label: 'Tax zones', to: '/shipping/tax', permission: 'settings:view' },
      { label: 'Tax classes', to: '/shipping/tax/classes', permission: 'settings:view' },
      { label: 'Currencies', to: '/currencies', permission: 'settings:view' },
      { label: 'Webhooks', to: '/webhooks', permission: 'settings:view' },
      { label: 'Search ops', to: '/search-ops', permission: 'products:update' },
    ],
  },
  {
    label: 'Moderation',
    items: [
      { label: 'Reviews', to: '/reviews', permission: 'reviews:view' },
      { label: 'Questions', to: '/questions', permission: 'reviews:view' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Staff', to: '/staff', permission: 'admin_users:view' },
      { label: 'Roles', to: '/roles', permission: 'admin_users:view' },
      { label: 'Audit log', to: '/audit-logs', permission: 'audit_log:view' },
      { label: 'Settings', to: '/settings', permission: 'settings:view' },
    ],
  },
];

/** Flatten the nav tree into a linear list for the command palette. */
export function flattenNav(groups: NavGroup[] = navConfig): NavItem[] {
  return groups.flatMap((g) => g.items.filter((i) => !i.hidden));
}

/** Filter nav groups by a permission-check predicate. Empty groups are dropped. */
export function filterNav(
  groups: NavGroup[],
  hasPermission: (permission: string) => boolean,
): NavGroup[] {
  return groups
    .map((g) => ({
      label: g.label,
      items: g.items.filter((i) => !i.hidden && (!i.permission || hasPermission(i.permission))),
    }))
    .filter((g) => g.items.length > 0);
}
