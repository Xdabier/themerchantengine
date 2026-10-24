import { expect, request } from '@playwright/test';
import { test as authedTest, expect as authedExpect } from './_auth-fixture';
import { getAdminCookies } from './_helpers';

// Storefront journeys all mutate the `home` page. Running them in parallel
// races the reorder/visibility/delete assertions against each other because
// all workers share the same seeded DB. Serialize within this file only.
authedTest.describe.configure({ mode: 'serial' });

/**
 * Phase 24.10 — storefront-config write journeys.
 *
 * Covers the full operator loop for `/storefront/*`:
 *   1. Pages list renders + drill-in to `home` sections.
 *   2. Sections list renders + reorder persists.
 *   3. Toggle visibility flips the Visible/Hidden badge.
 *   4. Create new section via editor → appears in list.
 *   5. Edit existing section title → persists after reload.
 *   6. Delete section via confirm → gone after refresh.
 *
 * Seed guarantees `home` has 5 sections (S19-compliant per-type configs).
 */

async function listHomeSections(
  baseURL: string,
): Promise<Array<{ id: string; type: string; sortOrder: number; isVisible: boolean }>> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.get('/api/v1/admin/storefront/pages/home/sections?pageSize=100', {
    headers: { Cookie: cookies },
  });
  const body = (await res.json()) as {
    data: Array<{ id: string; type: string; sortOrder: number; isVisible: boolean }>;
  };
  await ctx.dispose();
  return body.data.sort((a, b) => a.sortOrder - b.sortOrder);
}

authedTest('pages list: renders home + drill-in', async ({ page }) => {
  await page.goto('/storefront', { waitUntil: 'networkidle' });
  // Dismiss any stale Vite HMR error overlay before interacting with the page.
  // The overlay is dismissed by pressing Escape per the Vite error overlay spec.
  const viteOverlay = page.locator('vite-error-overlay');
  if (await viteOverlay.isVisible({ timeout: 1000 }).catch(() => false)) {
    await page.keyboard.press('Escape');
    await viteOverlay.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => null);
  }
  await expect(page.locator('[data-testid="storefront-pages-list-page"]')).toBeVisible();
  await expect(page.locator('[data-testid="storefront-pages-list-page"] h1')).toHaveText(
    'Storefront pages',
  );
  // Finding E16: the row used to be the raw slug and nothing else.
  await expect(page.locator('[data-testid="storefront-page-link-home"]')).toContainText('Home');

  const homeLink = page.locator('[data-testid="storefront-page-link-home"]');
  await expect(homeLink).toBeVisible();
  await homeLink.click();

  await expect(page.locator('[data-testid="storefront-sections-list-page"]')).toBeVisible();
  await expect(page.locator('[data-testid="storefront-sections-list"]')).toBeVisible();
  await page.screenshot({ path: '.e2e-review/journey-storefront-pages.png', fullPage: true });
});

authedTest('sections list: reorder first two → new order persists', async ({ page, baseURL }) => {
  const sections = await listHomeSections(baseURL!);
  expect(sections.length).toBeGreaterThan(1);
  const [first, second] = sections;

  await page.goto('/storefront/home', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="storefront-sections-list-page"]')).toBeVisible();

  // Move the second section up.
  const upBtn = page.locator(`[data-testid="storefront-section-up-${second.id}"]`);
  await upBtn.click();
  await expect(page.locator('[data-testid="storefront-sections-notice"]')).toContainText(
    'Order updated',
    { timeout: 10_000 },
  );

  await page.reload({ waitUntil: 'networkidle' });
  const rows = page.locator('[data-testid^="storefront-section-row-"]');
  const firstRowTestid = await rows.first().getAttribute('data-testid');
  expect(firstRowTestid).toBe(`storefront-section-row-${second.id}`);
  await page.screenshot({ path: '.e2e-review/journey-storefront-reorder.png', fullPage: true });

  // Revert to keep future test runs deterministic.
  await page.locator(`[data-testid="storefront-section-down-${second.id}"]`).click();
  await expect(page.locator('[data-testid="storefront-sections-notice"]')).toContainText(
    'Order updated',
    { timeout: 10_000 },
  );
});

authedTest('sections list: toggle visibility flips badge', async ({ page, baseURL }) => {
  const sections = await listHomeSections(baseURL!);
  const target = sections[sections.length - 1];
  const wasVisible = target.isVisible;

  await page.goto('/storefront/home', { waitUntil: 'networkidle' });
  const toggle = page.locator(`[data-testid="storefront-section-toggle-${target.id}"]`);
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();

  await expect(page.locator('[data-testid="storefront-sections-notice"]')).toContainText(
    wasVisible ? 'hidden' : 'visible',
    { ignoreCase: true, timeout: 10_000 },
  );

  await page.reload({ waitUntil: 'networkidle' });
  const row = page.locator(`[data-testid="storefront-section-row-${target.id}"]`);
  await expect(row).toContainText(wasVisible ? 'Hidden' : 'Visible');
  await page.screenshot({ path: '.e2e-review/journey-storefront-visibility.png', fullPage: true });

  // Flip back.
  await page.locator(`[data-testid="storefront-section-toggle-${target.id}"]`).click();
  await expect(page.locator('[data-testid="storefront-sections-notice"]')).toBeVisible({
    timeout: 10_000,
  });
});

authedTest('editor: create new TRUST_SIGNALS → appears in list', async ({ page }) => {
  // RICH_CONTENT was removed in S19 (DR-05 — only 5 surviving section types).
  // Use TRUST_SIGNALS as the simplest surviving type with a title.
  await page.goto('/storefront/home', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="storefront-sections-list-page"]')).toBeVisible();

  await page.locator('[data-testid="storefront-section-new"]').click();
  await expect(page.locator('[data-testid="storefront-section-editor-page"]')).toBeVisible();

  // TRUST_SIGNALS is the default or we select it explicitly.
  await page.locator('[data-testid="section-type-select"]').selectOption('TRUST_SIGNALS');
  await expect(page.locator('[data-testid="trust-signals-section-editor"]')).toBeVisible();

  const stamp = Date.now();
  const titleValue = `Journey Trust ${stamp}`;
  // Envelope title: translatable input — target the native input via id.
  await page.locator('input#section-title').fill(titleValue);

  // Fill the required trust-pillar fields so the form passes canSave().
  const titleHost = page.locator('[data-testid="trust-pillar-title-0-field"]').first();
  await titleHost.locator('input, textarea').first().fill('Fast');
  const subtitleHost = page.locator('[data-testid="trust-pillar-subtitle-0-field"]').first();
  await subtitleHost.locator('input, textarea').first().fill('Two-day shipping');

  await page.locator('[data-testid="section-editor-save"]').click();

  // Redirect back to /storefront/home.
  await authedExpect(page).toHaveURL(/\/storefront\/home/, { timeout: 15_000 });
  await expect(page.getByText(titleValue).first()).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: '.e2e-review/journey-storefront-create.png', fullPage: true });
});

authedTest('editor: edit existing section title → persists', async ({ page, baseURL }) => {
  const sections = await listHomeSections(baseURL!);
  const target = sections[0];

  await page.goto('/storefront/home', { waitUntil: 'networkidle' });
  await page.locator(`[data-testid="storefront-section-edit-${target.id}"]`).click();

  await expect(page.locator('[data-testid="storefront-section-editor-page"]')).toBeVisible({
    timeout: 15_000,
  });

  const newTitle = `Edited ${target.type} ${Date.now()}`;
  // A seeded title carries every locale and the list shows the admin's own
  // locale, so editing one tab alone would leave the listed text unchanged.
  // The page wrapper shows during the load skeleton; `all()` does not wait.
  const tabs = page.locator('[data-testid="section-title-tabs"] [role="tab"]');
  await expect(tabs.first()).toBeVisible({ timeout: 15_000 });
  for (const tab of await tabs.all()) {
    await tab.click();
    await page.locator('input#section-title').fill(newTitle);
  }
  await page.locator('[data-testid="section-editor-save"]').click();

  await authedExpect(page).toHaveURL(/\/storefront\/home/, { timeout: 15_000 });
  await expect(page.getByText(newTitle).first()).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: '.e2e-review/journey-storefront-edit-title.png', fullPage: true });
});

authedTest('sections list: delete via confirm → gone after refresh', async ({ page }) => {
  // Create a scratch section we can safely delete.
  // RICH_CONTENT was removed in S19 (DR-05). Use TRUST_SIGNALS instead.
  await page.goto('/storefront/home/sections/new', { waitUntil: 'networkidle' });
  await page.locator('[data-testid="section-type-select"]').selectOption('TRUST_SIGNALS');
  await expect(page.locator('[data-testid="trust-signals-section-editor"]')).toBeVisible();
  const deletableTitle = `To delete ${Date.now()}`;
  await page.locator('input#section-title').fill(deletableTitle);
  // Fill required config fields so canSave() enables the submit button.
  const titleHost = page.locator('[data-testid="trust-pillar-title-0-field"]').first();
  await titleHost.locator('input, textarea').first().fill('Fast');
  const subtitleHost = page.locator('[data-testid="trust-pillar-subtitle-0-field"]').first();
  await subtitleHost.locator('input, textarea').first().fill('Two-day shipping');
  await page.locator('[data-testid="section-editor-save"]').click();

  await authedExpect(page).toHaveURL(/\/storefront\/home/, { timeout: 15_000 });
  const row = page.locator('li', { hasText: deletableTitle });
  await expect(row).toBeVisible({ timeout: 10_000 });

  // Click the delete button inside that row.
  await row.getByRole('button', { name: /Delete/ }).click();

  // Confirm dialog opens. Title uses the humanized section-type label
  // ("Trust signals"), not the raw enum code — see storefront.utils.ts
  // sectionTypeLabel(), fixed in 9d4e3fa0 (admin entity-rendering: no raw
  // enum codes in the UI).
  const dialog = page.getByRole('dialog', { name: /Delete this Trust signals section/i });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: /Delete section/i }).click();

  await expect(page.locator('[data-testid="storefront-sections-notice"]')).toContainText(
    'deleted',
    { ignoreCase: true, timeout: 10_000 },
  );
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByText(deletableTitle)).toHaveCount(0);
  await page.screenshot({ path: '.e2e-review/journey-storefront-delete.png', fullPage: true });
});
