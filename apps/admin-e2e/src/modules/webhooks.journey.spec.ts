import { test, expect } from './_auth-fixture';
import { request } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * R5.4 — Webhooks admin journey.
 *
 * Covers `/webhooks` (list + delete), `/webhooks/new` (URL/events validation +
 * one-time secret reveal), `/webhooks/:id` (detail + test event + deliveries),
 * `/webhooks/:id/edit` (URL change + isActive toggle + 404 state). Live
 * backend. No `page.route()`, no MSW, no fixtures.
 *
 * Determinism: every write seeds its own `https://e2e-webhook-<timestamp>...`
 * URL via the admin API so concurrent browsers never collide.
 */

function uniqueUrl(label: string): string {
  return `https://e2e-webhook-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.example.com/hook`;
}

async function seedWebhook(
  baseURL: string,
  url: string,
  events: string[] = ['order.created'],
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; url: string; events: string[]; secret: string; isActive: boolean }> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/v1/admin/webhooks', {
    headers: { Cookie: cookies },
    data: { url, events, ...overrides },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[webhooks.journey] seed webhook failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
  const { data } = JSON.parse(raw) as {
    data: { id: string; url: string; events: string[]; secret: string; isActive: boolean };
  };
  return data;
}

async function deleteWebhookViaApi(baseURL: string, id: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  await ctx.delete(`/api/v1/admin/webhooks/${id}`, {
    headers: { Cookie: cookies },
  });
  await ctx.dispose();
}

test('/webhooks mounts, is a11y-clean, and shows seeded row', async ({ page, baseURL }) => {
  const seed = await seedWebhook(baseURL!, uniqueUrl('list'));
  try {
    await page.goto('/webhooks', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="webhooks-list-page"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator(`[data-testid="webhook-row-${seed.id}"]`)).toBeVisible();
    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });
  } finally {
    await deleteWebhookViaApi(baseURL!, seed.id);
  }
});

test('/webhooks/new rejects http URLs inline', async ({ page }) => {
  await page.goto('/webhooks/new', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="webhook-create-page"]')).toBeVisible({
    timeout: 10_000,
  });

  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });

  const urlField = page.locator('[data-testid="webhook-url"]').locator('input');
  await urlField.fill('http://example.com/hook');
  await urlField.blur();
  await expect(page.getByText(/https:\/\//i).first()).toBeVisible();

  const submit = page.locator('[data-testid="webhook-create-submit"]').locator('button');
  await expect(submit).toBeDisabled();
});

test('/webhooks/new submit stays disabled with no events selected', async ({ page }) => {
  await page.goto('/webhooks/new', { waitUntil: 'networkidle' });
  const urlField = page.locator('[data-testid="webhook-url"]').locator('input');
  await urlField.fill(uniqueUrl('noevents'));
  // Do not select any event.
  const submit = page.locator('[data-testid="webhook-create-submit"]').locator('button');
  await expect(submit).toBeDisabled();
});

test('/webhooks/new creates a webhook and reveals the secret once', async ({ page, baseURL }) => {
  const url = uniqueUrl('create');
  await page.goto('/webhooks/new', { waitUntil: 'networkidle' });
  await page.locator('[data-testid="webhook-url"]').locator('input').fill(url);
  await page.locator('[data-testid="webhook-event-order.created"]').check();

  await page.locator('[data-testid="webhook-create-submit"]').locator('button').click();

  const reveal = page.locator('[data-testid="webhook-secret-reveal"]');
  await expect(reveal).toBeVisible({ timeout: 10_000 });
  const secret = (await page.locator('[data-testid="webhook-secret-value"]').innerText()).trim();
  expect(secret.length).toBeGreaterThanOrEqual(16);

  // Cleanup via the admin API — locate the new row through the list endpoint.
  const cookies = getAdminCookies(baseURL!);
  const ctx = await request.newContext({ baseURL });
  const listRes = await ctx.get('/api/v1/admin/webhooks?pageSize=100', {
    headers: { Cookie: cookies },
  });
  const { data } = (await listRes.json()) as { data: Array<{ id: string; url: string }> };
  await ctx.dispose();
  const row = data.find((r) => r.url === url);
  if (row) await deleteWebhookViaApi(baseURL!, row.id);
});

test('/webhooks/:id renders detail page and is a11y-clean', async ({ page, baseURL }) => {
  const seed = await seedWebhook(baseURL!, uniqueUrl('detail'), ['order.created', 'order.shipped']);
  try {
    await page.goto(`/webhooks/${seed.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="webhook-detail-page"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(seed.url)).toBeVisible();
    await expect(page.locator('[data-testid="webhook-event-badges"]')).toContainText(
      'order.created',
    );
    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });
  } finally {
    await deleteWebhookViaApi(baseURL!, seed.id);
  }
});

test('/webhooks/:id test-event button announces queued delivery', async ({ page, baseURL }) => {
  const seed = await seedWebhook(baseURL!, uniqueUrl('test'));
  try {
    await page.goto(`/webhooks/${seed.id}`, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="webhook-test-button"]').locator('button').click();
    await expect(page.locator('[data-testid="webhook-test-result"]')).toContainText(
      /Test event queued/i,
      { timeout: 15_000 },
    );
    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });
  } finally {
    await deleteWebhookViaApi(baseURL!, seed.id);
  }
});

test('/webhooks/:id/edit updates the URL and reflects on detail', async ({ page, baseURL }) => {
  const seed = await seedWebhook(baseURL!, uniqueUrl('edit-from'));
  try {
    await page.goto(`/webhooks/${seed.id}/edit`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="webhook-edit-page"]')).toBeVisible({
      timeout: 10_000,
    });

    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });

    const newUrl = uniqueUrl('edit-to');
    const urlInput = page.locator('[data-testid="webhook-edit-url"]').locator('input');
    await urlInput.fill(newUrl);
    await page.locator('[data-testid="webhook-edit-submit"]').locator('button').click();

    await page.waitForURL(new RegExp(`/webhooks/${seed.id}($|\\?)`));
    await expect(page.getByText(newUrl)).toBeVisible({ timeout: 10_000 });
  } finally {
    await deleteWebhookViaApi(baseURL!, seed.id);
  }
});

test('/webhooks/:id/edit deactivates the webhook via isActive toggle', async ({
  page,
  baseURL,
}) => {
  const seed = await seedWebhook(baseURL!, uniqueUrl('toggle'));
  try {
    await page.goto(`/webhooks/${seed.id}/edit`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="webhook-edit-page"]')).toBeVisible({
      timeout: 10_000,
    });
    const toggle = page.locator('[data-testid="webhook-edit-active"]');
    await expect(toggle).toBeChecked();
    await toggle.uncheck();

    await page.locator('[data-testid="webhook-edit-submit"]').locator('button').click();
    await page.waitForURL(new RegExp(`/webhooks/${seed.id}($|\\?)`));
    await expect(page.getByText(/Disabled/i).first()).toBeVisible({ timeout: 10_000 });
  } finally {
    await deleteWebhookViaApi(baseURL!, seed.id);
  }
});

test('/webhooks delete removes the seeded row', async ({ page, baseURL }) => {
  const seed = await seedWebhook(baseURL!, uniqueUrl('del'));
  let cleanupNeeded = true;
  try {
    await page.goto('/webhooks', { waitUntil: 'networkidle' });
    const row = page.locator(`[data-testid="webhook-row-${seed.id}"]`);
    await expect(row).toBeVisible({ timeout: 10_000 });

    await page.locator(`[data-testid="webhook-delete-${seed.id}"]`).locator('button').click();
    const dialog = page.getByRole('dialog', { name: /Delete this webhook/i });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });
    await dialog.getByRole('button', { name: /^Delete$/i }).click();

    await expect(row).toHaveCount(0, { timeout: 10_000 });
    cleanupNeeded = false;
  } finally {
    if (cleanupNeeded) await deleteWebhookViaApi(baseURL!, seed.id);
  }
});

test('/webhooks/:id/edit shows not-found state for a deleted webhook', async ({
  page,
  baseURL,
}) => {
  const seed = await seedWebhook(baseURL!, uniqueUrl('gone'));
  await deleteWebhookViaApi(baseURL!, seed.id);
  await page.goto(`/webhooks/${seed.id}/edit`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="webhook-edit-not-found"]')).toBeVisible({
    timeout: 10_000,
  });
  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });
});
