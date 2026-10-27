import { filterNav, flattenNav, navConfig } from './nav.config';

/**
 * Permissions the backend actually issues. Source: `@Permissions(...)` grep
 * in `apps/api/src/modules/**` — see `docs/site/reference/permissions.md`
 * Keep alphabetical for diff clarity.
 */
const backendPermissions = new Set<string>([
  'admin_users:view',
  'analytics:view',
  'assets:view',
  'audit_log:view',
  'campaigns:view',
  'carriers:view',
  'categories:view',
  'checkout:view',
  'cms:view',
  'customers:view',
  'gift_cards:view',
  'inventory:view',
  'notifications:view',
  'orders:view',
  'payment_methods:view',
  'products:update',
  'products:view',
  'promotions:view',
  'returns:view',
  'reviews:view',
  'seo:view',
  'settings:view',
  'shipping:view',
  'storefront_config:view',
]);

describe('navConfig', () => {
  it('has no duplicate routes', () => {
    const paths = navConfig.flatMap((g) => g.items.map((i) => i.to));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('flattens visible group items into a single list', () => {
    const visibleCount = navConfig.reduce((n, g) => n + g.items.filter((i) => !i.hidden).length, 0);
    expect(flattenNav().length).toBe(visibleCount);
  });

  it('every permission is in canonical backend form', () => {
    const canonicalRegex = /^[a-z_]+:[a-z_]+$/;
    for (const group of navConfig) {
      for (const item of group.items) {
        if (!item.permission) continue;
        expect(item.permission).toMatch(canonicalRegex);
      }
    }
  });

  it('every permission string is a known backend permission', () => {
    for (const group of navConfig) {
      for (const item of group.items) {
        if (!item.permission) continue;
        expect(backendPermissions.has(item.permission)).toBe(true);
      }
    }
  });

  /**
   * QA D5: three registered routes were reachable from nowhere. Each entry's
   * permission must equal its route guard so `filterNav` never offers a link
   * that lands on /403.
   */
  it.each([
    ['/checkout-settings', 'checkout:view'],
    ['/shipping/countries', 'settings:view'],
    ['/seo/health', 'seo:view'],
  ])('exposes %s behind %s', (to, permission) => {
    const item = navConfig.flatMap((g) => g.items).find((i) => i.to === to);
    expect(item).toBeDefined();
    expect(item?.permission).toBe(permission);
    expect(item?.hidden).toBeFalsy();
  });

  it('hidden nav items do not appear in flattenNav output', () => {
    const hiddenRoutes = navConfig
      .flatMap((g) => g.items)
      .filter((i) => i.hidden)
      .map((i) => i.to);
    const visibleRoutes = flattenNav().map((i) => i.to);
    for (const route of hiddenRoutes) {
      expect(visibleRoutes).not.toContain(route);
    }
  });
});

describe('filterNav', () => {
  it('drops items whose permission fails the check', () => {
    const groups = filterNav(navConfig, (p) => p === 'orders:view');
    const labels = groups.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toEqual(['Orders']);
  });

  it('drops empty groups', () => {
    const groups = filterNav(navConfig, () => false);
    expect(groups).toEqual([]);
  });

  it.each([
    ['/checkout-settings', 'checkout:view'],
    ['/shipping/countries', 'settings:view'],
    ['/seo/health', 'seo:view'],
  ])('drops %s when %s is denied', (to, permission) => {
    const groups = filterNav(navConfig, (p) => p !== permission);
    const routes = groups.flatMap((g) => g.items.map((i) => i.to));
    expect(routes).not.toContain(to);
  });

  it('keeps items that have no permission constraint', () => {
    const groups = filterNav(
      [{ label: 'X', items: [{ label: 'Unsecured', to: '/x' }] }],
      () => false,
    );
    expect(groups).toEqual([{ label: 'X', items: [{ label: 'Unsecured', to: '/x' }] }]);
  });
});
