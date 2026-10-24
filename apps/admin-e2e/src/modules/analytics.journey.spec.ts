import { test, expect } from './_auth-fixture';
import { request } from '@playwright/test';
import { getAdminCookies } from './_helpers';

/**
 * Phase R2 — analytics admin journey.
 *
 * Covers the screens + endpoints added by the Analytics module: the `/analytics`
 * hub (KPI overview + sub-report tiles), five read-only sub-reports (funnel,
 * products, revenue, customers, search), and the pixels configuration form
 * (GET + PATCH round-trip). Live backend; zero fixtures, zero page.route().
 */

async function apiGet<T>(baseURL: string, path: string): Promise<T> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.get(path, { headers: { Cookie: cookies } });
  const body = (await res.json()) as T;
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[analytics.journey] GET ${path} -> ${res.status()}`);
  }
  return body;
}

test('/analytics hub page renders KPI tiles + sub-report links', async ({ page }) => {
  await page.goto('/analytics', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="analytics-hub-page"]')).toBeVisible();
  await expect(page.locator('[data-testid="analytics-kpi-grid"]')).toBeVisible();
  for (const slug of ['funnel', 'products', 'revenue', 'customers', 'search', 'pixels']) {
    await expect(page.locator(`[data-testid="analytics-link-${slug}"]`)).toBeVisible();
  }
  await page.screenshot({ path: '.e2e-review/journey-analytics-hub.png', fullPage: true });
});

test('/analytics/funnel renders the conversion-funnel report', async ({ page }) => {
  await page.goto('/analytics/funnel', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="analytics-funnel-page"]')).toBeVisible();
  await expect(page.locator('[data-testid="analytics-funnel-chart"]')).toBeVisible({
    timeout: 10_000,
  });
  await page.screenshot({ path: '.e2e-review/journey-analytics-funnel.png', fullPage: true });
});

test('the funnel entry stage carries no drop-off figure', async ({ page }) => {
  await page.goto('/analytics/funnel', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="analytics-funnel-page"]')).toBeVisible();
  await expect(page.locator('[data-testid="analytics-funnel-chart"]')).toBeVisible({
    timeout: 10_000,
  });

  // Finding E7: stage one used to render "DROP-OFF 0%".
  await expect(page.locator('[data-testid="analytics-funnel-dropoff-product_view"]')).toHaveCount(
    0,
  );
});

test('analytics empty states do not blame a range nobody picked', async ({ page }) => {
  // Finding E6: the copy said "in the selected range" on first load.
  await page.goto('/analytics/search', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="analytics-search-page"]')).toBeVisible();
  await expect(page.locator('[data-testid="analytics-search-range"]')).toHaveCount(0);

  const empty = page.locator('[data-testid="analytics-search-empty"]');
  if (await empty.count()) {
    await expect(empty).toContainText('recorded yet');
    await expect(empty).not.toContainText('selected range');
  }

  // Applying a range echoes it back in the canonical admin format.
  await page.locator('[data-testid="analytics-range-from-input"] input').fill('2026-05-01');
  await page.locator('[data-testid="analytics-range-to-input"] input').fill('2026-05-31');
  await expect(page.locator('[data-testid="analytics-search-range"]')).toContainText(
    '1 May 2026 – 31 May 2026',
  );
});

test('/analytics/products renders the product-performance table', async ({ page }) => {
  await page.goto('/analytics/products', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="analytics-products-page"]')).toBeVisible();
  await expect(page.locator('[data-testid="analytics-products-table"]')).toBeVisible({
    timeout: 10_000,
  });
  await page.screenshot({ path: '.e2e-review/journey-analytics-products.png', fullPage: true });
});

test('/analytics/revenue renders the revenue metrics panel', async ({ page }) => {
  await page.goto('/analytics/revenue', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="analytics-revenue-page"]')).toBeVisible();
  await expect(page.locator('[data-testid="analytics-revenue-metrics"]')).toBeVisible({
    timeout: 10_000,
  });
  await page.screenshot({ path: '.e2e-review/journey-analytics-revenue.png', fullPage: true });
});

test('/analytics/customers renders the customer analytics panel', async ({ page }) => {
  await page.goto('/analytics/customers', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="analytics-customers-page"]')).toBeVisible();
  await expect(page.locator('[data-testid="analytics-customers-metrics"]')).toBeVisible({
    timeout: 10_000,
  });
  await page.screenshot({ path: '.e2e-review/journey-analytics-customers.png', fullPage: true });
});

test('/analytics/search renders the search analytics panel', async ({ page }) => {
  await page.goto('/analytics/search', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="analytics-search-page"]')).toBeVisible();
  await expect(page.locator('[data-testid="analytics-search-metrics"]')).toBeVisible({
    timeout: 10_000,
  });
  await page.screenshot({ path: '.e2e-review/journey-analytics-search.png', fullPage: true });
});

test('/analytics/pixels renders the pixels configuration form', async ({ page }) => {
  await page.goto('/analytics/pixels', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="analytics-pixels-page"]')).toBeVisible();
  await expect(page.locator('[data-testid="pixels-form"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="pixels-form-ga"]')).toBeVisible();
  await expect(page.locator('[data-testid="pixels-form-meta"]')).toBeVisible();
  await expect(page.locator('[data-testid="pixels-form-tiktok"]')).toBeVisible();
  await expect(page.locator('[data-testid="pixels-form-snap"]')).toBeVisible();
  await page.screenshot({ path: '.e2e-review/journey-analytics-pixels.png', fullPage: true });
});

test('pixels form surfaces regex validation on a bad Google Analytics ID', async ({ page }) => {
  await page.goto('/analytics/pixels', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="analytics-pixels-page"]')).toBeVisible();

  const input = page.locator('[data-testid="pixels-form-ga"] input');
  await input.fill('not$valid!');
  await input.blur();

  // Submit stays disabled while the form is invalid — mirrors other forms.
  const submit = page.locator('[data-testid="pixels-form-submit"] button');
  await expect(submit).toBeDisabled();
  await expect(page.locator('[data-testid="pixels-form-ga-error"]')).toBeVisible();
});

test('pixels form round-trips a PATCH (write → reload → value persisted)', async ({
  page,
  baseURL,
}) => {
  const timestamp = Date.now().toString().slice(-6);
  const newValue = `G-R2${timestamp}`;

  const before = await apiGet<{
    data: { data: { googleAnalyticsId?: string | null } } | { googleAnalyticsId?: string | null };
  }>(baseURL!, '/api/v1/admin/analytics/pixels');
  // Restore value on teardown so repeat runs stay idempotent.
  const inner = (before.data as { data?: unknown })?.data ?? before.data;
  const original = (inner as { googleAnalyticsId?: string | null }).googleAnalyticsId ?? '';

  await page.goto('/analytics/pixels', { waitUntil: 'networkidle' });
  const gaInput = page.locator('[data-testid="pixels-form-ga"] input');
  await gaInput.fill(newValue);

  const submit = page.locator('[data-testid="pixels-form-submit"] button');
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.locator('[data-testid="pixels-form-saved"]')).toHaveText(/Saved/i, {
    timeout: 15_000,
  });

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="pixels-form-ga"] input')).toHaveValue(newValue);

  // Restore — keeps the seed state clean across repeat runs.
  const cookies = getAdminCookies(baseURL!);
  const ctx = await request.newContext({ baseURL });
  await ctx.patch('/api/v1/admin/analytics/pixels', {
    headers: { Cookie: cookies },
    data: { googleAnalyticsId: original },
  });
  await ctx.dispose();
});
