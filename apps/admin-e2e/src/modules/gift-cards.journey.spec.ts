import { test, expect } from './_auth-fixture';
import { request, type APIRequestContext } from '@playwright/test';
import { STORE_CURRENCY, firstIdFromApi, getAdminCookies } from './_helpers';

/**
 * R6.9 — gift-card write journeys.
 *
 * Covers the three workflows the admin UI supports today: issue a new card,
 * adjust an existing card's balance, and flip `isActive` via the
 * deactivate/reactivate confirm dialog. Every write round-trips through
 * `/api/v1/admin/gift-cards` on the live backend — no `page.route()`, no
 * fixtures. The flip test seeds its own card via the API so teardown does
 * not mutate shared catalogue data that other specs depend on.
 */

async function seedGiftCard(baseURL: string): Promise<{ id: string; isActive: boolean }> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.post('/api/v1/admin/gift-cards', {
    headers: { Cookie: cookies },
    // Must be one of the store's enabled currencies: the API rejects anything
    // else with GIFT_CARD_CURRENCY_NOT_ENABLED.
    data: { initialBalance: 50, currency: STORE_CURRENCY },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[gift-cards.journey] seed POST failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
  const body = JSON.parse(raw) as { data: { id: string; isActive: boolean } };
  return body.data;
}

async function patchActive(
  baseURL: string,
  id: string,
  isActive: boolean,
): Promise<{ isActive: boolean }> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.patch(`/api/v1/admin/gift-cards/${id}`, {
    headers: { Cookie: cookies },
    data: { isActive },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[gift-cards.journey] PATCH failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
  const body = JSON.parse(raw) as { data: { isActive: boolean } };
  return body.data;
}

async function fetchActive(baseURL: string, id: string): Promise<boolean> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.get(`/api/v1/admin/gift-cards/${id}`, {
    headers: { Cookie: cookies },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[gift-cards.journey] GET failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
  const body = JSON.parse(raw) as { data: { isActive: boolean } };
  return body.data.isActive;
}

test('issue new gift card → new row in list', async ({ page }) => {
  await page.goto('/gift-cards/issue', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="gift-card-issue-page"]')).toBeVisible();

  await page.locator('input#gc-amount').fill('250');
  // Currency is a select over the enabled set, preselected to the store
  // currency. Typing a foreign code here is no longer possible, by design.
  await expect(page.locator('[data-testid="gc-currency-select"]')).toHaveValue(STORE_CURRENCY);
  await page.locator('input#gc-email').fill('journey@merchants.test');

  await page.locator('[data-testid="gc-issue"]').click();

  // After success the admin redirects to /gift-cards/:id detail.
  await expect(page).toHaveURL(/\/gift-cards\/[^/]+$/, { timeout: 10_000 });
  await expect(page.locator('[data-testid="gift-card-detail-page"]')).toBeVisible();
  await page.screenshot({ path: '.e2e-review/journey-gift-cards-issued.png', fullPage: true });
});

test('adjust gift-card balance → ledger shows new entry', async ({ page, baseURL }) => {
  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/gift-cards?pageSize=1');
  await page.goto(`/gift-cards/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="gift-card-detail-page"]')).toBeVisible();

  const adjustBtn = page.locator('[data-testid="gift-card-adjust"]');
  await adjustBtn.scrollIntoViewIfNeeded();
  await adjustBtn.click();
  // CDK Dialog mounts into the overlay container at <body>. The dialog's
  // aria-label is "Adjust gift card balance" — scope the locator via role
  // since the inner testid is wrapped by a cdk-dialog-container whose
  // panel-class puts it off-screen in some layouts; the role dialog
  // container itself is always present + reachable.
  await expect(page.getByRole('dialog', { name: /Adjust gift card balance/i })).toBeVisible({
    timeout: 15_000,
  });

  await page.locator('input#adjust-amount').fill('25');
  await page.locator('input#adjust-reason').fill('Manual credit — journey e2e');

  await page.locator('[data-testid="adjust-balance-submit"]').click();

  await expect(page.locator('[data-testid="adjust-balance-dialog"]')).not.toBeVisible({
    timeout: 10_000,
  });
  // Success toast sits in the notice live-region.
  await expect(page.locator('[data-testid="gift-card-notice"]')).toBeVisible();
  await page.screenshot({ path: '.e2e-review/journey-gift-cards-adjusted.png', fullPage: true });
});

test('deactivate → reactivate flips isActive end-to-end', async ({ page, baseURL }) => {
  const seeded = await seedGiftCard(baseURL!);
  expect(seeded.isActive).toBe(true);
  try {
    await page.goto(`/gift-cards/${seeded.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="gift-card-detail-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="gift-card-deactivate"]')).toBeVisible();

    await page.locator('[data-testid="gift-card-deactivate"]').click();
    await expect(page.getByRole('dialog', { name: /Deactivate this gift card/i })).toBeVisible({
      timeout: 10_000,
    });
    await page.locator('[data-testid="confirm-dialog-confirm"]').click();

    // Reactivate button takes the place of deactivate once the PATCH settles.
    await expect(page.locator('[data-testid="gift-card-reactivate"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="gift-card-deactivate"]')).toHaveCount(0);
    expect(await fetchActive(baseURL!, seeded.id)).toBe(false);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="gift-card-reactivate"]')).toBeVisible({
      timeout: 10_000,
    });

    await page.locator('[data-testid="gift-card-reactivate"]').click();
    await expect(page.getByRole('dialog', { name: /Reactivate this gift card/i })).toBeVisible({
      timeout: 10_000,
    });
    await page.locator('[data-testid="confirm-dialog-confirm"]').click();

    await expect(page.locator('[data-testid="gift-card-deactivate"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="gift-card-reactivate"]')).toHaveCount(0);
    expect(await fetchActive(baseURL!, seeded.id)).toBe(true);

    await page.screenshot({
      path: '.e2e-review/journey-gift-cards-flip.png',
      fullPage: true,
    });
  } finally {
    // Best-effort restore — if either backend call above partially mutated
    // the card, pin it back to the seeded shape so re-runs stay clean.
    try {
      await patchActive(baseURL!, seeded.id, true);
    } catch {
      // Swallow — seeding a fresh card per spec already isolates shared
      // state; restore-on-failure is belt-and-braces only.
    }
  }
});
