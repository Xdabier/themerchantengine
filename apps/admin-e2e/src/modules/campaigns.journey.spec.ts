import { test, expect } from './_auth-fixture';
import { request, type APIRequestContext } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';
import { ADMIN_LOCALES } from '../support/locale-matrix';

/**
 * NE9 — Campaigns + Subscribers admin journey (real API).
 *
 * Covers the campaigns list, the composer (compose → live preview both locales
 * in a sandboxed frame → send-test), and the subscribers list (mount, a11y,
 * status-filter URL round-trip). All against the dockerized backend — no
 * page.route, no fixtures.
 */

/** Create a DRAFT campaign via the admin API so the editor tests are deterministic. */
async function createCampaignViaApi(baseURL: string, name: string): Promise<string> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.post('/api/v1/admin/campaigns', {
    headers: { Cookie: cookies },
    data: {
      name,
      segment: 'ALL_CONFIRMED',
      subject: { en: 'Big sale', fr: 'Grande vente' },
      body: { en: 'Shop our latest offers.', fr: 'Decouvrez nos dernieres offres.' },
    },
  });
  const body = (await res.json()) as { data?: { id: string }; id?: string };
  await ctx.dispose();
  const id = body.data?.id ?? body.id;
  if (!id) throw new Error('campaign create returned no id');
  return id;
}

test('/campaigns mounts, is a11y-clean', async ({ page }) => {
  await page.goto('/campaigns', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="campaigns-list-page"]')).toBeVisible({
    timeout: 10_000,
  });
  await injectAxe(page);
  await checkA11y(page, '[data-testid="campaigns-list-page"]');
});

test('compose a new campaign via the UI and land on the editor', async ({ page }) => {
  await page.goto('/campaigns/new', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="campaign-editor-page"]')).toBeVisible({
    timeout: 10_000,
  });

  await page.fill('[data-testid="camp-name"] input', 'Journey campaign');
  await page.selectOption('[data-testid="camp-segment"]', 'ALL_CONFIRMED');
  await page.fill('[data-testid="camp-subject-field"] input', 'Hello from the journey');
  await page.fill(
    '[data-testid="camp-body-field"] textarea',
    'Body copy for the journey campaign.',
  );

  await page.click('[data-testid="camp-save"] button');
  await expect(page).toHaveURL(/\/campaigns\/[a-z0-9]+$/i, { timeout: 10_000 });
  await expect(page.locator('[data-testid="campaign-editor-page"]')).toContainText('Draft');
});

test('editor live-preview renders both store locales in a sandboxed frame', async ({
  page,
  baseURL,
}) => {
  const id = await createCampaignViaApi(baseURL!, `Preview ${Date.now()}`);
  await page.goto(`/campaigns/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="campaign-editor-page"]')).toBeVisible({
    timeout: 10_000,
  });

  await page.click('[data-testid="camp-preview-run"]');
  const frame = page.locator('[data-testid="camp-preview-frame"]');
  await expect(frame).toBeVisible({ timeout: 10_000 });
  await expect(frame).toHaveAttribute('srcdoc', /<!doctype html>/i);
  await expect(frame).toHaveAttribute('sandbox', '');

  // The store default locale renders first, then every other served locale on click.
  await expect(frame).toHaveAttribute('srcdoc', new RegExp(`lang="${ADMIN_LOCALES[0]}"`));
  for (const locale of ADMIN_LOCALES.slice(1)) {
    await page.click(`[data-testid="camp-preview-locale-${locale}"]`);
    await expect(frame).toHaveAttribute('srcdoc', new RegExp(`lang="${locale}"`));
  }

  await injectAxe(page);
  await checkA11y(page, '[data-testid="campaign-editor-page"]');
});

test('editor "send test to me" surfaces an outcome notice', async ({ page, baseURL }) => {
  const id = await createCampaignViaApi(baseURL!, `Test ${Date.now()}`);
  await page.goto(`/campaigns/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="camp-send-test"]')).toBeVisible({ timeout: 10_000 });
  await page.click('[data-testid="camp-send-test"]');
  await expect(page.locator('[data-testid="camp-notice"]')).toContainText(/test/i, {
    timeout: 10_000,
  });
});

test('/subscribers mounts, is a11y-clean, and status filter round-trips URL', async ({ page }) => {
  await page.goto('/subscribers', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="subscribers-list-page"]')).toBeVisible({
    timeout: 10_000,
  });
  await injectAxe(page);
  await checkA11y(page, '[data-testid="subscribers-list-page"]');

  await page.click('[data-testid="sub-status-confirmed"]');
  await expect(page).toHaveURL(/status=confirmed/);
  await expect(page.locator('[data-testid="sub-status-confirmed"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.click('[data-testid="sub-status-all"]');
  await expect(page).not.toHaveURL(/status=confirmed/);
});

test('subscribers list search round-trips through the URL and the API', async ({ page }) => {
  // QA D6 sweep: the backend accepted `search` all along, the page had no box.
  await page.goto('/subscribers', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="subscribers-list-page"]')).toBeVisible({
    timeout: 10_000,
  });

  const call = page.waitForResponse(
    (res) => res.url().includes('/api/v1/admin/subscribers') && res.url().includes('search='),
    { timeout: 15_000 },
  );
  await page.locator('[data-testid="subscribers-search"]').fill('zzzz-no-such-subscriber');
  await page.waitForURL(/[?&]search=zzzz-no-such-subscriber/, { timeout: 10_000 });
  expect((await call).ok()).toBeTruthy();

  await page.locator('[data-testid="subscribers-search"]').fill('');
  await page.waitForURL((url) => !url.searchParams.has('search'), { timeout: 10_000 });
});

test('settings home links to Campaigns & Subscribers', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' });
  const card = page.locator('[data-testid="settings-card-campaigns"]');
  await expect(card).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(/\/campaigns/);
  await expect(page.locator('[data-testid="campaigns-list-page"]')).toBeVisible({
    timeout: 10_000,
  });
});
