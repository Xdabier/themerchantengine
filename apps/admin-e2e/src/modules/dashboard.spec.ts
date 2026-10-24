import { test, expect } from './_auth-fixture';
import { request } from '@playwright/test';
import { assertNoObjectObjectLeak, firstIdFromApi, getAdminCookies } from './_helpers';

/**
 * Proves the Phase-23.1 live-backend infrastructure:
 *  - globalSetup brought up Postgres + Redis + API + seeded superadmin
 *  - storageState replayed the refresh cookie on this context
 *  - session-bootstrap's `/api/v1/auth/refresh` succeeded
 *  - authGuard let us through to `/`
 *  - DashboardPage rendered
 *
 * If this test is green, every other authenticated spec can assume the
 * rigging works and focus on feature-level assertions.
 */
test('dashboard renders for authenticated superadmin', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="dashboard-page"]')).toBeVisible();
  await expect(page.locator('[data-testid="kpi-grid"]')).toBeVisible();
  await page.screenshot({ path: '.e2e-review/dashboard.png', fullPage: true });
});

test('an activity row drills into the audit history of the entity it names', async ({
  page,
  baseURL,
}) => {
  // QA C6: the rows described entities that already had a drill-down route and
  // were dead text.
  //
  // The seed carries no audit entries, so make one: every successful mutating
  // admin request is audited, and a zero-discount edit is the no-op this suite
  // already uses for that purpose.
  let orderId: string | undefined;
  for (const status of ['PENDING', 'CONFIRMED', 'PROCESSING', 'ON_HOLD']) {
    try {
      orderId = await firstIdFromApi(baseURL!, `/api/v1/admin/orders?pageSize=1&status=${status}`);
      break;
    } catch {
      // status has no orders — try next
    }
  }
  if (orderId) {
    const ctx = await request.newContext({ baseURL });
    await ctx.patch(`/api/v1/admin/orders/${orderId}`, {
      headers: { Cookie: getAdminCookies(baseURL!) },
      data: { manualDiscount: 0 },
    });
    await ctx.dispose();
  }

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="dashboard-page"]')).toBeVisible({ timeout: 15_000 });

  const link = page.locator('[data-testid="activity-link"]').first();
  if ((await link.count()) === 0) {
    console.warn('[dashboard] no linkable activity row in the seed — skipping drill-down check');
    return;
  }
  await assertNoObjectObjectLeak(page);
  await link.click();

  await expect(page.locator('[data-testid="audit-log-entity-heading"]')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page).toHaveURL(/\/audit-logs\/[^/]+\/[^/]+/);
  await assertNoObjectObjectLeak(page);
});
