import { test, expect } from './_auth-fixture';
import { request, type Page, type Response } from '@playwright/test';
import { getAdminCookies } from './_helpers';

/**
 * Promotions admin journey — edit + soft-deactivate flows against the
 * live backend. Covers the detail-page form (value, active toggle),
 * the detail-page destructive footer (confirm → redirect), the list-row
 * quick action (confirm → row refetch), and the 409 coupon-conflict
 * error mapping. Seeds its own rows via the admin API — no fixtures,
 * no `page.route()`.
 */

async function seedPromotion(
  baseURL: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; couponCode: string }> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const couponCode = `E2E_${unique}`.toUpperCase();
  const res = await ctx.post('/api/v1/admin/promotions', {
    headers: { Cookie: cookies },
    data: {
      name: { default: `E2E promo ${unique}` },
      type: 'PERCENTAGE',
      applicationMethod: 'COUPON',
      couponCode,
      value: 10,
      isActive: true,
      ...overrides,
    },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[promotions.journey] seed promotion failed: ${res.status()} ${raw.slice(0, 200)}`,
    );
  }
  const { data } = JSON.parse(raw) as { data: { id: string; couponCode: string } };
  return { id: data.id, couponCode: data.couponCode ?? couponCode };
}

async function deletePromotionViaApi(baseURL: string, id: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  await ctx.delete(`/api/v1/admin/promotions/${id}`, {
    headers: { Cookie: cookies },
  });
  await ctx.dispose();
}

function waitForPromotionPatch(page: Page, id: string): Promise<Response> {
  return page.waitForResponse(
    (res) =>
      new URL(res.url()).pathname.endsWith(`/v1/admin/promotions/${id}`) &&
      res.request().method() === 'PATCH',
  );
}

test('adjust promotion value → save → persists after reload', async ({ page, baseURL }) => {
  // Seed a dedicated row so concurrent tests cannot delete it under us.
  const seed = await seedPromotion(baseURL!, { value: 10 });
  try {
    await page.goto(`/promotions/${seed.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="promotion-detail-page"]')).toBeVisible();

    const valueInput = page.locator('input#promo-value');
    await valueInput.fill('42');

    const patched = waitForPromotionPatch(page, seed.id);
    await page.locator('[data-testid="promo-save"]').click();
    expect((await patched).status()).toBe(200);
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.screenshot({
      path: '.e2e-review/journey-promotions-value-saved.png',
      fullPage: true,
    });

    await page.goto(`/promotions/${seed.id}`, { waitUntil: 'networkidle' });
    // Value field may render as "42" or "42.00" depending on coercion — match either.
    await expect(page.locator('input#promo-value')).toHaveValue(/^42(\.0+)?$/);
  } finally {
    await deletePromotionViaApi(baseURL!, seed.id);
  }
});

test('deactivate promotion → isActive checkbox flips', async ({ page, baseURL }) => {
  // Seed a dedicated row so concurrent tests cannot delete it under us.
  const seed = await seedPromotion(baseURL!, { isActive: true });
  try {
    await page.goto(`/promotions/${seed.id}`, { waitUntil: 'networkidle' });

    const active = page.locator('[data-testid="promo-active"]');
    const before = await active.isChecked();

    // The checkbox is a plain input; clicking it and saving persists.
    await active.click();
    const patched = waitForPromotionPatch(page, seed.id);
    await page.locator('[data-testid="promo-save"]').click();
    expect((await patched).status()).toBe(200);
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.goto(`/promotions/${seed.id}`, { waitUntil: 'networkidle' });
    const after = await page.locator('[data-testid="promo-active"]').isChecked();
    expect(after).toBe(!before);
    await page.screenshot({
      path: '.e2e-review/journey-promotions-active-toggle.png',
      fullPage: true,
    });
  } finally {
    await deletePromotionViaApi(baseURL!, seed.id);
  }
});

test('deactivate from detail footer → confirm → redirects to /promotions', async ({
  page,
  baseURL,
}) => {
  const seed = await seedPromotion(baseURL!);
  try {
    await page.goto(`/promotions/${seed.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="promotion-detail-page"]')).toBeVisible();

    await page.locator('[data-testid="promo-deactivate"]').click();
    await page.locator('[data-testid="confirm-dialog-confirm"]').click();

    // Wait for the list URL — exclude the detail route by requiring no trailing ID segment.
    await page.waitForURL(/\/promotions(\?|$)/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/promotions(\?|$)/);
  } finally {
    await deletePromotionViaApi(baseURL!, seed.id);
  }
});

test('deactivate cancel leaves the promotion active', async ({ page, baseURL }) => {
  const seed = await seedPromotion(baseURL!);
  try {
    await page.goto(`/promotions/${seed.id}`, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="promo-deactivate"]').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();

    // Still on the detail page, button still visible.
    await expect(page).toHaveURL(new RegExp(`/promotions/${seed.id}`));
    await expect(page.locator('[data-testid="promo-deactivate"]')).toBeVisible();
  } finally {
    await deletePromotionViaApi(baseURL!, seed.id);
  }
});

test('coupon-code conflict surfaces the 409 error banner', async ({ page, baseURL }) => {
  const seedA = await seedPromotion(baseURL!);
  const seedB = await seedPromotion(baseURL!);
  try {
    await page.goto(`/promotions/${seedB.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="promotion-detail-page"]')).toBeVisible();

    const coupon = page.locator('input#promo-code');
    await coupon.fill(seedA.couponCode);

    await page.locator('[data-testid="promo-save"]').click();
    const banner = page.locator('[data-testid="promotion-detail-error"]');
    await expect(banner).toContainText(/Coupon code conflict/i, { timeout: 10_000 });
  } finally {
    await deletePromotionViaApi(baseURL!, seedA.id);
    await deletePromotionViaApi(baseURL!, seedB.id);
  }
});

test('deactivate from list-row → confirm → row refetches as inactive', async ({
  page,
  baseURL,
}) => {
  const seed = await seedPromotion(baseURL!);
  try {
    // Navigate with a filter that keeps our seeded row visible even on a busy list.
    await page.goto('/promotions?pageSize=100', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="promotions-list-page"]')).toBeVisible();

    const rowButton = page.locator(`[data-testid="promo-row-deactivate-${seed.id}"]`);
    await expect(rowButton).toBeVisible({ timeout: 10_000 });
    await rowButton.click();

    await page.locator('[data-testid="confirm-dialog-confirm"]').click();

    // Per API contract (admin-api-reference.md §DELETE /v1/admin/promotions/:id),
    // DELETE sets deletedAt = now() — the row is soft-deleted and no longer visible
    // in any list view (the list query always filters WHERE deletedAt IS NULL).
    // Assert the row is gone from the unfiltered list.
    await page.goto('/promotions?pageSize=100', { waitUntil: 'networkidle' });
    await expect(page.locator(`[data-testid="promo-row-${seed.id}"]`)).not.toBeVisible({
      timeout: 10_000,
    });
  } finally {
    await deletePromotionViaApi(baseURL!, seed.id);
  }
});
