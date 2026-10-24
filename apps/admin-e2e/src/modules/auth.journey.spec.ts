import { test as base, expect, type Page } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';

/**
 * BA3 — admin authentication journeys against the live API (Better Auth, DR-24).
 *
 * The migration's headline fix is Scenario A: a signed-in operator survives any
 * number of hard refreshes. These journeys drive the password login, sign-out,
 * the failure + session-expired surfaces, and the forgot / reset entry points
 * end to end. The 2FA-enrolment / magic-link / email-verify full flows need
 * real email tokens or an authenticator and are covered by the backend e2e
 * plus the admin component specs.
 *
 * Plain `base` test (no auth fixture) — every journey drives the login flow
 * itself or starts deliberately logged out.
 */

const EMAIL = 'superadmin@merchants.test';
const PASSWORD = 'Admin123!';
/**
 * A seeded CUSTOMER with a Better Auth credential account and a verified email
 * (`prisma/seed.ts`). Registering one through the API instead leaves it
 * unverified, so the login fails on verification rather than on the role gate
 * under test.
 */
const CUSTOMER_EMAIL = 'customer1@test.com';
const CUSTOMER_PASSWORD = 'password123';

async function signIn(page: Page): Promise<void> {
  await page.goto('/auth/login', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
  await page.locator('input#login-email').fill(EMAIL);
  await page.locator('input#login-password').fill(PASSWORD);
  // Blur password so Angular's reactive form validity settles before submit.
  await page.locator('input#login-password').blur();
  // Backstop for the zoneless memoized-computed bug: typing valid credentials
  // must flip the rendered submit button from disabled to enabled. A stuck
  // button would otherwise surface only as an opaque click timeout below.
  await expect(page.locator('[data-testid="login-submit"] button[type="submit"]')).toBeEnabled();
  // Click the inner native submit button inside <app-button>. The host element
  // carries data-testid="login-submit" but Playwright clicks the host, not
  // necessarily the inner <button type="submit">. Targeting the inner <button>
  // directly ensures the native form submit event fires (which triggers ngSubmit).
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/v1/auth/sign-in/email') && r.request().method() === 'POST',
      { timeout: 20_000 },
    ),
    page.locator('[data-testid="login-submit"] button[type="submit"]').click(),
  ]);
  expect(resp.status()).toBe(200);
  await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 15_000 });
  await expect(page.locator('[data-testid="app-shell-main"]')).toBeVisible({ timeout: 15_000 });
}

base.describe('admin auth journey', () => {
  base.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  base('session survives ten hard refreshes (Scenario A)', async ({ page }) => {
    await signIn(page);
    for (let i = 0; i < 10; i++) {
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page, `bounced to login on refresh #${i + 1}`).not.toHaveURL(/\/auth\/login/, {
        timeout: 15_000,
      });
      await expect(page.locator('[data-testid="app-shell-main"]')).toBeVisible({
        timeout: 15_000,
      });
    }
    await page.screenshot({
      path: '.e2e-review/journey-auth-refresh-survives.png',
      fullPage: true,
    });
  });

  base('sign out clears the session — a reload stays logged out', async ({ page }) => {
    await signIn(page);
    await page.locator('[data-testid="topbar-logout"]').click();
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 15_000 });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 15_000 });
  });

  /**
   * Finding AD6 / AD11. The Better Auth session payload carries the account
   * role, and the admin schema dropped it, so a CUSTOMER parsed into a valid
   * AdminUser with no roles and no permissions and the shell mounted with
   * their name on it. Only the server-side 403s kept the data safe. On
   * production the cookie is cross-subdomain, so a customer signed in on the
   * storefront presents it to the admin host: this is prod behaviour, not a
   * localhost artifact.
   */
  base('a customer account is refused with a no-access message and no shell', async ({ page }) => {
    await page.goto('/auth/login', { waitUntil: 'networkidle' });
    await page.locator('input#login-email').fill(CUSTOMER_EMAIL);
    await page.locator('input#login-password').fill(CUSTOMER_PASSWORD);
    await page.locator('input#login-password').blur();
    await expect(page.locator('[data-testid="login-submit"] button[type="submit"]')).toBeEnabled();
    await page.locator('[data-testid="login-submit"] button[type="submit"]').click();

    const error = page.locator('[data-testid="login-error"]');
    await expect(error).toBeVisible({ timeout: 15_000 });
    // Specific, not the generic sign-in failure: the credentials were correct.
    await expect(error).toContainText('does not have access to the admin dashboard');
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.locator('[data-testid="app-shell-main"]')).toHaveCount(0);

    // The refusal must not survive as a half-commit: a reload stays out.
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 15_000 });
    await expect(page.locator('[data-testid="app-shell-main"]')).toHaveCount(0);
  });

  base('staff sign-in is unchanged by the role gate', async ({ page }) => {
    await signIn(page);
    await expect(page.locator('[data-testid="app-shell-main"]')).toBeVisible();
  });

  base('wrong credentials show an error and stay on the login page', async ({ page }) => {
    await page.goto('/auth/login', { waitUntil: 'networkidle' });
    await page.locator('input#login-email').fill(EMAIL);
    await page.locator('input#login-password').fill('definitely-the-wrong-password');
    await page.locator('input#login-password').blur();
    await page.locator('[data-testid="login-submit"] button[type="submit"]').click();
    await expect(page.locator('[data-testid="login-error"]')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  base('the session-expired banner shows on ?reason=session-expired', async ({ page }) => {
    await page.goto('/auth/login?reason=session-expired', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="login-session-expired"]')).toBeVisible();
  });

  base('the login page is a11y-clean', async ({ page }) => {
    await page.goto('/auth/login', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
    await injectAxe(page);
    await checkA11y(page, '[data-testid="login-form"]', { detailedReport: true });
  });

  base('forgot-password submits and shows the enumeration-safe banner', async ({ page }) => {
    await page.goto('/auth/forgot', { waitUntil: 'networkidle' });
    await page.locator('input#forgot-email').fill('nobody@merchants.test');
    await page.locator('input#forgot-email').press('Tab');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/v1/auth/request-password-reset'), {
        timeout: 15_000,
      }),
      page.locator('input#forgot-email').press('Enter'),
    ]);
    await expect(page.locator('[data-testid="forgot-success"]')).toBeVisible({ timeout: 15_000 });
  });

  base('the forgot-password page is a11y-clean', async ({ page }) => {
    await page.goto('/auth/forgot', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="forgot-form"]')).toBeVisible();
    await injectAxe(page);
    await checkA11y(page, '[data-testid="forgot-form"]', { detailedReport: true });
  });

  base('reset-password without a token shows the missing-token warning', async ({ page }) => {
    await page.goto('/auth/reset', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="reset-missing-token"]')).toBeVisible();
  });
});
