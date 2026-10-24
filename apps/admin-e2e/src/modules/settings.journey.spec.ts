import { test, expect } from './_auth-fixture';
import { request } from '@playwright/test';
import { getAdminCookies } from './_helpers';

/**
 * `general.contactEmail` is a store singleton, not a per-test row.
 *
 * The journey below used to overwrite it with
 * `support+<timestamp>@merchants.test` and walk away. That exact value is what
 * the QA pass found sitting in the dev database months later, and even on the
 * test database it survives into every later spec and into the authed
 * visual-regression baselines that screenshot this very screen. A journey that
 * mutates a singleton owns putting it back.
 */
async function readContactEmail(baseURL: string): Promise<string> {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.get('/api/v1/admin/settings', {
    headers: { Cookie: getAdminCookies(baseURL) },
  });
  const body = (await res.json()) as { data: { general?: { contactEmail?: string } } };
  await ctx.dispose();
  return body.data.general?.contactEmail ?? '';
}

async function writeContactEmail(baseURL: string, value: string): Promise<void> {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.patch('/api/v1/admin/settings', {
    headers: { Cookie: getAdminCookies(baseURL) },
    data: { contactEmail: value },
  });
  const ok = res.ok();
  const detail = ok ? '' : `${res.status()} ${await res.text()}`;
  await ctx.dispose();
  if (!ok) throw new Error(`[settings.journey] restoring contactEmail failed: ${detail}`);
}

/**
 * Deactivate a staff account this spec created.
 *
 * Every run used to leave one behind. On the test database they pile up in the
 * staff list other specs page through; on any database that outlives a run
 * they are real accounts with a known password.
 */
async function deactivateStaffByEmail(baseURL: string, email: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  try {
    const list = await ctx.get(`/api/v1/admin/staff?search=${encodeURIComponent(email)}`, {
      headers: { Cookie: cookies },
    });
    if (!list.ok()) return;
    const body = (await list.json()) as { data?: { id: string; email: string }[] };
    const match = body.data?.find((row) => row.email === email);
    if (!match) return;
    await ctx.delete(`/api/v1/admin/staff/${match.id}`, { headers: { Cookie: cookies } });
  } finally {
    await ctx.dispose();
  }
}

/**
 * Phase 24.6 — settings + RBAC write journeys.
 *
 * Journeys covered:
 *   1. Settings → General: edit contact email, save, reload, verify persistence.
 *   2. Users → Staff: create a brand-new staff member, see it appear in the list.
 *   3. Settings → Integrations: the decoy editor is gone and points at the real
 *      pixel screen (plan I phase I9); the pixel screen itself persists an id.
 *
 * Staff-role picks SUPPORT (lowest-privilege) to avoid upgrading an
 * account that other specs may re-use via superadmin.
 */

test('settings-general: update contact email → persists across reload, then restores', async ({
  page,
  baseURL,
}) => {
  const original = await readContactEmail(baseURL!);

  try {
    await page.goto('/settings/general', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="settings-general-page"]')).toBeVisible();

    const emailInput = page.locator('input#gen-email');
    const newEmail = `support+${Date.now()}@merchants.test`;
    await emailInput.fill(newEmail);

    await page.locator('[data-testid="settings-general-save"]').click();
    await expect(page.locator('[data-testid="settings-general-notice"] p')).toBeVisible({
      timeout: 10_000,
    });

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('input#gen-email')).toHaveValue(newEmail);
    await page.screenshot({
      path: '.e2e-review/journey-settings-general-saved.png',
      fullPage: true,
    });
  } finally {
    await writeContactEmail(baseURL!, original);
  }

  // Asserted through the UI, not only through the API: the restore has to be
  // what the next spec and the visual-regression baseline actually see. The
  // last line is the one that would have caught the original defect — it is
  // the shape of the value that leaked.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('input#gen-email')).toHaveValue(original);
  expect(original).not.toMatch(/^support\+\d+@merchants\.test$/);
});

test('staff-list: create new staff → appears in table, then deactivates', async ({
  page,
  baseURL,
}) => {
  await page.goto('/staff', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="staff-list-page"]')).toBeVisible();

  // The create panel is a <details> that's closed by default.
  await page.locator('[data-testid="staff-create-panel"] summary').click();

  const ts = Date.now();
  const email = `staff.e2e.${ts}@merchants.test`;
  try {
    await page.locator('input#staff-first').fill('E2E');
    await page.locator('input#staff-last').fill('Tester');
    await page.locator('input#staff-email').fill(email);
    await page.locator('input#staff-password').fill('Admin123!');
    await page.locator('[data-testid="staff-role-select"]').selectOption('SUPPORT');

    await page.locator('[data-testid="staff-create-submit"]').click();
    await expect(page.locator('[data-testid="staff-notice"] p')).toBeVisible({ timeout: 10_000 });

    // New staff row should render in the list — confirm by email substring.
    await expect(page.getByText(email).first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: '.e2e-review/journey-staff-created.png', fullPage: true });
  } finally {
    // DELETE /v1/admin/staff/:id deactivates rather than removing the row
    // (docs/admin-api-reference.md). That is the right disposition anyway:
    // audit-log entries reference staff accounts, so deleting one strands them.
    await deactivateStaffByEmail(baseURL!, email);
  }
});

test('settings-general: social links persist across reload', async ({ page }) => {
  // `socialLinks` has been a valid API key since the settings module shipped
  // and this screen had no control for it, so the operator could not edit the
  // profiles the storefront footer now renders.
  await page.goto('/settings/general', { waitUntil: 'networkidle' });
  // The id, not the testid: `[attr.data-testid]` lands on the `app-input`
  // host and the real control is inside it, so a fill on the host is a no-op.
  const facebook = page.locator('input#gen-social-facebook');
  await expect(facebook).toBeVisible();

  const url = `https://facebook.com/e2e-i3-${Date.now()}`;
  await facebook.fill(url);
  await page.locator('[data-testid="settings-general-save"]').click();
  await expect(page.locator('[data-testid="settings-general-notice"] p')).toBeVisible({
    timeout: 10_000,
  });

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('input#gen-social-facebook')).toHaveValue(url);

  // Cleared before leaving. These are global settings rows, and the authed
  // visual-regression suite screenshots this very screen: a value left behind
  // here fails a baseline that has nothing to do with this journey.
  await page.locator('input#gen-social-facebook').fill('');
  await page.locator('[data-testid="settings-general-save"]').click();
  await expect(page.locator('[data-testid="settings-general-notice"] p')).toBeVisible({
    timeout: 10_000,
  });
});

test('settings-appearance: a logo URL persists, which it never could before', async ({ page }) => {
  // The page has written `logoUrl` since it shipped and the API had no such
  // key, so the request schema stripped the body and the screen reported
  // "saved" for a value that was never stored.
  await page.goto('/settings/appearance', { waitUntil: 'networkidle' });
  const logo = page.locator('input#appearance-logo');
  await expect(logo).toBeVisible();

  const url = `https://cdn.demo.example/e2e-i3-${Date.now()}.png`;
  await logo.fill(url);
  await page.locator('[data-testid="settings-appearance-save"]').click();
  await expect(page.locator('[data-testid="settings-appearance-notice"] p')).toBeVisible({
    timeout: 10_000,
  });

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('input#appearance-logo')).toHaveValue(url);

  // Cleared for the same reason as the social link above: the visual-regression
  // suite screenshots this screen, and the logo preview it renders for a set
  // value is a real pixel difference.
  await page.locator('input#appearance-logo').fill('');
  await page.locator('[data-testid="settings-appearance-save"]').click();
  await expect(page.locator('[data-testid="settings-appearance-notice"] p')).toBeVisible({
    timeout: 10_000,
  });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('input#appearance-logo')).toHaveValue('');
});

test('settings-integrations: no editor, and a link to the screen that works', async ({ page }) => {
  await page.goto('/settings/integrations', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="settings-integrations-page"]')).toBeVisible();

  // Six fields used to report "Integrations saved." for values the request
  // schema stripped before they left the browser.
  await expect(page.locator('[data-testid="settings-integrations-page"] input')).toHaveCount(0);
  await expect(page.locator('[data-testid="settings-integrations-save"]')).toHaveCount(0);

  await page.locator('[data-testid="settings-integrations-pixels-link"]').click();
  await expect(page).toHaveURL(/\/analytics\/pixels$/);
  await expect(page.locator('[data-testid="analytics-pixels-page"]')).toBeVisible();
});

test('analytics-pixels: a GA4 id persists across reload', async ({ page }) => {
  // The editor that actually stores what `/settings/integrations` pretended to.
  await page.goto('/analytics/pixels', { waitUntil: 'networkidle' });
  const input = page.locator('input#pixels-ga');
  await expect(input).toBeVisible();

  const id = `G-E2EI9${Date.now().toString().slice(-6)}`;
  await input.fill(id);
  await page.locator('[data-testid="pixels-form-submit"] button').click();
  await expect(page.locator('[data-testid="pixels-form-saved"]')).toContainText('Saved');

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('input#pixels-ga')).toHaveValue(id);

  // Leave the store without a pixel: a leftover id would inject a vendor tag
  // into every storefront spec that runs after this one.
  await page.locator('input#pixels-ga').fill('');
  await page.locator('[data-testid="pixels-form-submit"] button').click();
  await expect(page.locator('[data-testid="pixels-form-saved"]')).toContainText('Saved');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('input#pixels-ga')).toHaveValue('');
});
