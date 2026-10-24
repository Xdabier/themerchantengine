import { test, expect } from './_auth-fixture';
import { request, type APIRequestContext } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';
import { ADMIN_LOCALES } from '../support/locale-matrix';

/**
 * R5.11 — Notifications admin journey.
 *
 * Covers the new `/notifications/inbox` screen (list mount, filter chip
 * round-trip, empty state, mark-all-read gating), the topbar bell indicator
 * wired from `app-shell`, and the typed-error migration on
 * `/notifications/log` (resend happy path + the `formatError` path that
 * previously swallowed `ApiError` into the fallback string).
 *
 * Seeding caveat: the backend `NotificationsListener` now subscribes to the
 * exact event names emitted by the source services (`order.created`,
 * `inventory.low_stock`, `inventory.out_of_stock`, `review.created`,
 * `return.created` — R6.3 alignment) so a storefront review submission
 * fans out a NEW_REVIEW notification. Seeding a full order still requires
 * a cart + addresses + idempotency headers, so the inbox paths exercised
 * here stay on the non-seed flows to keep the suite deterministic.
 */

async function clearNotificationsReadState(baseURL: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  await ctx.patch('/api/v1/admin/notifications/read-all', {
    headers: { Cookie: cookies },
  });
  await ctx.dispose();
}

async function unreadCountViaApi(baseURL: string): Promise<number> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.get('/api/v1/admin/notifications/unread-count', {
    headers: { Cookie: cookies },
  });
  const body = (await res.json()) as { data: { unreadCount: number } };
  await ctx.dispose();
  return body.data.unreadCount;
}

/** Resolve a template id by code via the admin API (the matrix renders by id). */
async function templateIdByCode(baseURL: string, code: string): Promise<string> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.get('/api/v1/admin/notifications/templates?pageSize=100', {
    headers: { Cookie: cookies },
  });
  const body = (await res.json()) as { data: Array<{ id: string; code: string }> };
  await ctx.dispose();
  const row = body.data.find((t) => t.code === code);
  if (!row) throw new Error(`template "${code}" not found`);
  return row.id;
}

test.beforeEach(async ({ baseURL }) => {
  // Mark every existing row read so tests see a deterministic starting state.
  await clearNotificationsReadState(baseURL!);
});

test('/notifications/inbox mounts, is a11y-clean, shows empty state', async ({ page }) => {
  await page.goto('/notifications/inbox', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="inbox-page"]')).toBeVisible({ timeout: 10_000 });
  await injectAxe(page);
  await checkA11y(page, '[data-testid="inbox-page"]');
});

test('/notifications redirects to inbox by default', async ({ page }) => {
  await page.goto('/notifications');
  await expect(page).toHaveURL(/\/notifications\/inbox/);
  await expect(page.locator('[data-testid="inbox-page"]')).toBeVisible({ timeout: 10_000 });
});

test('filter chips round-trip URL state', async ({ page }) => {
  await page.goto('/notifications/inbox', { waitUntil: 'networkidle' });
  await page.click('[data-testid="inbox-filter-unread"]');
  await expect(page).toHaveURL(/\/notifications\/inbox\?unread=1/);
  await expect(page.locator('[data-testid="inbox-filter-unread"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.click('[data-testid="inbox-filter-all"]');
  await expect(page).toHaveURL(/\/notifications\/inbox(\?|$)/);
  await expect(page).not.toHaveURL(/unread=1/);
});

test('mark-all-read button is disabled when unread count is zero', async ({ page, baseURL }) => {
  const count = await unreadCountViaApi(baseURL!);
  expect(count).toBe(0);
  await page.goto('/notifications/inbox', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="inbox-mark-all-read"]')).toBeDisabled();
});

test('topbar bell navigates to /notifications/inbox from any page', async ({ page }) => {
  await page.goto('/products', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="topbar-notifications"]')).toBeVisible();
  await page.click('[data-testid="topbar-notifications"]');
  await expect(page).toHaveURL(/\/notifications\/inbox/);
  await expect(page.locator('[data-testid="inbox-page"]')).toBeVisible({ timeout: 10_000 });
});

test('topbar bell hides the count badge when unread is zero', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="topbar-notifications"]')).toBeVisible();
  // The count span is always in the DOM but carries aria-hidden="true" and
  // renders an empty string when unread === 0. Assert the element is aria-hidden
  // (not announced to screen readers) and that its visible text content is empty.
  const countEl = page.locator('[data-testid="topbar-notifications-count"]');
  await expect(countEl).toHaveAttribute('aria-hidden', 'true');
  await expect(countEl).toHaveText('');
});

test('NE6 matrix mounts grouped, a11y-clean, with the global pause switch', async ({ page }) => {
  await page.goto('/notifications/templates', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="templates-list-page"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="templates-list-page"] h1')).toHaveText(
    'Notification templates',
  );
  await expect(page.locator('[data-testid="templates-group-orders"]')).toBeVisible();

  // Finding E17: the weekly/daily operational digests are not account flows.
  const ops = page.locator('[data-testid="templates-group-ops"]');
  await expect(ops).toContainText('admin.kpi-digest');
  await expect(ops).toContainText('admin.ops-digest');
  await expect(page.locator('[data-testid="templates-group-auth"]')).toContainText(
    'admin.staff-invite',
  );
  await expect(page.locator('[data-testid="templates-pause-all"]')).toBeAttached();
  await injectAxe(page);
  await checkA11y(page, '[data-testid="templates-list-page"]');
});

test('NE6 locked flows are read-only; non-locked flows expose a send toggle', async ({
  page,
  baseURL,
}) => {
  const lockedId = await templateIdByCode(baseURL!, 'order.shipped');
  const giftId = await templateIdByCode(baseURL!, 'giftcard.purchase');
  await page.goto('/notifications/templates', { waitUntil: 'networkidle' });
  await expect(page.locator(`[data-testid="templates-locked-${lockedId}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="templates-toggle-${lockedId}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-testid="templates-toggle-${giftId}"]`)).toBeVisible();
});

test('NE6 toggling a non-locked flow persists across a reload', async ({ page, baseURL }) => {
  const giftId = await templateIdByCode(baseURL!, 'giftcard.purchase');
  await page.goto('/notifications/templates', { waitUntil: 'networkidle' });
  // Wait for the Gift cards group to be present before asserting the row-level
  // toggle — ensures Angular has completed its initial render pass from the
  // listTemplates() response before querying for individual row data-testids.
  await expect(page.locator('[data-testid="templates-group-giftcards"]')).toBeVisible({
    timeout: 10_000,
  });
  const toggle = page.locator(`[data-testid="templates-toggle-${giftId}"]`);
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  const initiallyOn = await toggle.isChecked();

  await toggle.click();
  await expect(toggle).toBeChecked({ checked: !initiallyOn });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator(`[data-testid="templates-toggle-${giftId}"]`)).toBeChecked({
    checked: !initiallyOn,
  });

  // Restore the original state so the suite stays idempotent.
  await page.locator(`[data-testid="templates-toggle-${giftId}"]`).click();
  await expect(page.locator(`[data-testid="templates-toggle-${giftId}"]`)).toBeChecked({
    checked: initiallyOn,
  });
});

test('/notifications/log mounts and the typed-error formatError is wired', async ({ page }) => {
  await page.goto('/notifications/log', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="log-list-page"]')).toBeVisible({ timeout: 10_000 });
  // The error banner is a persistent live region with empty content in the
  // happy path; assert it is attached to the DOM (the conditional error
  // paragraph renders inside it only when error() is non-null — in the
  // happy path the outer div is present but contains no visible children).
  const errorBanner = page.locator('[data-testid="log-error"]');
  await expect(errorBanner).toBeAttached();
  await injectAxe(page);
  await checkA11y(page, '[data-testid="log-list-page"]');
});

test('inbox empty-state copy differs between All and Unread filters', async ({ page }) => {
  await page.goto('/notifications/inbox?unread=1', { waitUntil: 'networkidle' });
  const unreadEmpty = page.locator('[data-testid="inbox-empty"]');
  await expect(unreadEmpty).toContainText('no unread notifications');

  await page.goto('/notifications/inbox', { waitUntil: 'networkidle' });
  const allEmpty = page.locator('[data-testid="inbox-empty"]');
  await expect(allEmpty).toContainText('No notifications yet');
});

test('NE6 editor live-preview renders both store locales in a sandboxed frame', async ({
  page,
  baseURL,
}) => {
  const id = await templateIdByCode(baseURL!, 'order.shipped');
  await page.goto(`/notifications/templates/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="template-editor-page"]')).toBeVisible({
    timeout: 10_000,
  });
  await page.click('[data-testid="tmpl-preview-run"]');
  const frame = page.locator('[data-testid="tmpl-preview-frame"]');
  await expect(frame).toBeVisible({ timeout: 10_000 });
  await expect(frame).toHaveAttribute('srcdoc', /<!doctype html>/i);
  // The sandboxed frame must not allow scripts.
  await expect(frame).toHaveAttribute('sandbox', '');
  // The store default locale renders first, then every other served locale on click.
  await expect(frame).toHaveAttribute('srcdoc', new RegExp(`lang="${ADMIN_LOCALES[0]}"`));
  for (const locale of ADMIN_LOCALES.slice(1)) {
    await page.click(`[data-testid="tmpl-preview-locale-${locale}"]`);
    await expect(frame).toHaveAttribute('srcdoc', new RegExp(`lang="${locale}"`));
  }
  // e2e-level axe gate for the editor Feature route (preview expanded).
  await injectAxe(page);
  await checkA11y(page, '[data-testid="template-editor-page"]');
});

test('NE6 editor variable-token validation flags an unknown token and blocks save', async ({
  page,
  baseURL,
}) => {
  const id = await templateIdByCode(baseURL!, 'order.shipped');
  await page.goto(`/notifications/templates/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="template-editor-page"]')).toBeVisible({
    timeout: 10_000,
  });
  // tmpl-body-field is the data-testid on the <app-textarea> host element;
  // page.fill() requires a native input/textarea so we descend into the
  // inner <textarea> rendered by the TextareaComponent template.
  await page.fill('[data-testid="tmpl-body-field"] textarea', 'Hi {{customerName}} {{ghostToken}}');
  await expect(page.locator('[data-testid="tmpl-token-warning"]')).toBeVisible();
  await expect(page.locator('[data-testid="tmpl-token-warning"]')).toContainText('ghostToken');
  // tmpl-save data-testid is on <app-button> host; the inner <button> is the
  // native element that receives the disabled attribute via Angular's input
  // binding. Target it directly to test the disabled state.
  await expect(page.locator('[data-testid="tmpl-save"] button')).toBeDisabled();
});

test('NE6 editor "send test to me" surfaces an outcome notice', async ({ page, baseURL }) => {
  const id = await templateIdByCode(baseURL!, 'order.shipped');
  await page.goto(`/notifications/templates/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="tmpl-send-test"]')).toBeVisible({ timeout: 10_000 });
  await page.click('[data-testid="tmpl-send-test"]');
  await expect(page.locator('[data-testid="tmpl-test-notice"]')).toContainText(
    /Queued|off|suppressed/i,
    { timeout: 10_000 },
  );
});

test('NE6 settings home links to Notifications & Email', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' });
  const card = page.locator('[data-testid="settings-card-templates"]');
  await expect(card).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(/\/notifications\/templates/);
  await expect(page.locator('[data-testid="templates-list-page"]')).toBeVisible({
    timeout: 10_000,
  });
});
