import { test as base, expect, request, type BrowserContext } from '@playwright/test';

/**
 * Phase 23.5 — permission + negative tests.
 *
 * Logs in as `manager@merchants.test` whose custom role only carries
 * products / categories / inventory / orders / promotions / assets /
 * shipping permissions. Navigating to anything outside those must land
 * on /403 via permissionGuard.
 *
 * Uses an inline auth fixture (not the superadmin `_auth-fixture`) because
 * these specs need the manager's restricted session, not the superadmin's.
 *
 * BA3 (DR-24): updated from the retired `/api/v1/auth/login` + refreshToken
 * cookie to the Better Auth `/api/v1/auth/sign-in/email` endpoint that sets
 * `better-auth.session_token` + `better-auth.session_data` cookies.
 */

async function loginAs(
  ctx: BrowserContext,
  baseURL: string,
  creds: { email: string; password: string },
): Promise<void> {
  const api = await request.newContext({ baseURL });
  const res = await api.post('/api/v1/auth/sign-in/email', {
    data: { email: creds.email, password: creds.password },
  });
  if (!res.ok()) {
    throw new Error(`[permission-spec] login failed: ${res.status()} ${await res.text()}`);
  }
  const state = await api.storageState();
  await api.dispose();
  const sessionCookies = state.cookies.filter((c) => c.name.startsWith('better-auth'));
  if (!sessionCookies.length) {
    throw new Error(
      '[permission-spec] no better-auth session cookies in state — check the seed and DR-24 cookie setup',
    );
  }
  await ctx.addCookies(sessionCookies);
}

const managerTest = base.extend({
  context: async ({ context, baseURL }, use) => {
    if (!baseURL) throw new Error('baseURL required');
    await loginAs(context, baseURL, {
      email: 'manager@merchants.test',
      password: 'Admin123!',
    });
    await use(context);
  },
});

managerTest('manager without customers perm redirects to /403 on /customers', async ({ page }) => {
  await page.goto('/customers', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/403/);
  await expect(page.getByRole('heading', { name: /Access denied/i })).toBeVisible();
  await page.screenshot({ path: '.e2e-review/permission-customers-403.png', fullPage: true });
});

managerTest('manager without settings perm redirects to /403 on /settings', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/403/);
  await page.screenshot({ path: '.e2e-review/permission-settings-403.png', fullPage: true });
});

managerTest(
  'manager without audit-logs perm redirects to /403 on /audit-logs',
  async ({ page }) => {
    await page.goto('/audit-logs', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/403/);
    await page.screenshot({ path: '.e2e-review/permission-audit-logs-403.png', fullPage: true });
  },
);

managerTest('manager CAN reach /products (module in their grant)', async ({ page }) => {
  await page.goto('/products', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="products-list-page"]')).toBeVisible();
  await page.screenshot({ path: '.e2e-review/permission-products-allowed.png', fullPage: true });
});

// Unauthenticated — no cookie at all — should bounce to /auth/login.
base('unauthenticated navigation to / bounces to login', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/auth\/login/);
  await page.screenshot({ path: '.e2e-review/permission-unauth-bounce.png', fullPage: true });
});

// Authenticated but unknown path — renders the not-found page inside the shell.
base('authenticated visit to unknown route renders not-found', async ({ page, baseURL }) => {
  await loginAs(page.context(), baseURL!, {
    email: 'superadmin@merchants.test',
    password: 'Admin123!',
  });
  await page.goto('/this-route-does-not-exist', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: /Not found|404/i })).toBeVisible();
  await page.screenshot({ path: '.e2e-review/permission-unknown-route.png', fullPage: true });
});
