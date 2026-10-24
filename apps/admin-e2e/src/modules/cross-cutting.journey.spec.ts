import { test as base, expect, request, type BrowserContext } from '@playwright/test';
import { test, expect as authedExpect } from './_auth-fixture';

/**
 * Phase 24.7 — cross-cutting journeys that span multiple modules.
 *
 * Journeys covered:
 *   1. Unauthenticated login flow → lands on dashboard.
 *   2. Global search (Cmd/Ctrl-K) → jump-to-route from results.
 *   3. Sign out → bounces back to /auth/login and clears session.
 */

// Unauthenticated spec — uses plain Playwright test (no auth fixture).
base('login: email + password → dashboard', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/auth/login', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="login-form"]')).toBeVisible();

  await page.locator('input#login-email').fill('superadmin@merchants.test');
  await page.locator('input#login-password').fill('Admin123!');
  // Blur the password field so Angular's form validity propagates through the
  // OnPush + zoneless chain before we poke the submit button. Without this
  // the button reports `disabled` to Playwright even though the form is
  // logically valid.
  await page.locator('input#login-password').blur();

  const [loginResp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/v1/auth/sign-in/email') && r.request().method() === 'POST',
      { timeout: 20_000 },
    ),
    // Click the inner native submit button inside <app-button data-testid="login-submit">.
    // The host element carries the testid, but the inner <button type="submit"> is what
    // triggers the native form submit event → Angular's (ngSubmit) handler.
    page.locator('[data-testid="login-submit"] button[type="submit"]').click(),
  ]);
  expect(loginResp.status()).toBe(200);

  await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 15_000 });
  await expect(page.locator('[data-testid="app-shell-main"]')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: '.e2e-review/journey-login-success.png', fullPage: true });
});

test('global search: open palette → navigate to first result', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="app-shell-main"]')).toBeVisible();

  await page.locator('[data-testid="topbar-search"]').click();
  await authedExpect(page.locator('[data-testid="palette-input"]')).toBeVisible({
    timeout: 10_000,
  });

  // Type a substring likely to match seeded content (products + categories).
  await page.locator('[data-testid="palette-input"]').fill('ship');
  // Give the overlay time to resolve network results; debounce is 200ms.
  await page.waitForTimeout(800);

  // Pick the first palette row if any came back; tolerate no matches too.
  const firstRow = page.locator('[data-testid="palette-row-0"]');
  if (await firstRow.count()) {
    await firstRow.click();
    await authedExpect(page).not.toHaveURL(/\/$/, { timeout: 10_000 });
    await page.screenshot({ path: '.e2e-review/journey-palette-jumped.png', fullPage: true });
  } else {
    // Empty state is still a valid render — screenshot it for the review bundle.
    await page.screenshot({ path: '.e2e-review/journey-palette-empty.png', fullPage: true });
  }
});

/**
 * The sign-out journey deliberately does NOT live here.
 *
 * This file runs on the shared superadmin session that `_auth-fixture.ts`
 * replays into every worker, and Better Auth sign-out deletes the session row
 * named by the cookie it is given. Clicking logout here therefore revoked the
 * one credential the whole authenticated suite depends on, and the five-minute
 * `cookieCache` hid it until the failures surfaced minutes later in unrelated
 * files. `auth.journey.spec.ts` owns the journey, on its own freshly
 * signed-in session, and asserts more than this did.
 * `fixture-contract.spec.ts` keeps it that way.
 */

test('a disabled control is visually distinct from an idle one', async ({ page }) => {
  // QA C5: the shared button did dim to 50 % opacity, but on the secondary
  // variant that turned the paper-white border into a mid grey matching the
  // neutral-700 chrome, so a disabled pager still read as clickable.
  // pageSize=1 forces a second page: the shared pager (plan E, finding E13)
  // only renders its nav when there is more than one page.
  await page.goto('/orders?pageSize=1', { waitUntil: 'networkidle' });
  await authedExpect(page.locator('[data-testid="orders-list-page"]')).toBeVisible({
    timeout: 15_000,
  });

  const prev = page.locator('[data-testid="orders-prev"] button');
  await authedExpect(prev).toBeDisabled();

  // Export CSV is the right reference: same `secondary` variant as the pager,
  // differing only in size, and size classes never touch colour.
  const reference = page.locator('[data-testid="orders-export-csv"] button');
  await authedExpect(reference).toBeEnabled();

  const styleOf = (locator: typeof prev) =>
    locator.evaluate((node) => {
      const s = getComputedStyle(node);
      return { border: s.borderTopColor, color: s.color, cursor: s.cursor };
    });

  const disabled = await styleOf(prev);
  const idle = await styleOf(reference);

  expect(disabled.border).not.toBe(idle.border);
  expect(disabled.color).not.toBe(idle.color);
  expect(disabled.cursor).toBe('not-allowed');
});
