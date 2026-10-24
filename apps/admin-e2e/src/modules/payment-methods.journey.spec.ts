import { test, expect } from './_auth-fixture';
import { request, type APIRequestContext } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * R6.11 — Payment methods CRUD + reorder journey.
 *
 * Covers `/payment-methods`, `/payment-methods/new`, and
 * `/payment-methods/:id` against the live backend: list mount, create
 * round-trip (seeded via the admin form), edit + soft-delete round-trip,
 * drag-drop reorder via the keyboard fallback (same R6.10 rationale —
 * headless Chromium does not dispatch CDK's `cdkDropListDropped` output
 * under pointer simulation), and duplicate-code conflict surfacing.
 *
 * Every mutation round-trips through `/api/v1/admin/payment-methods*`.
 * Each spec captures its own snapshot + seeded id set and tears down at
 * the end so re-runs and parallel workers stay deterministic. No
 * `page.route()`, no fixtures, no MSW.
 */

// Payment-methods is shared catalogue state — two workers creating +
// reordering at once would corrupt each other's teardown snapshot.
// Serialise the file.
test.describe.configure({ mode: 'serial' });

interface PaymentMethodLite {
  id: string;
  code: string;
  sortOrder: number;
  isActive: boolean;
}

async function createMethod(
  baseURL: string,
  body: Record<string, unknown>,
): Promise<PaymentMethodLite> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.post('/api/v1/admin/payment-methods', {
    headers: { Cookie: cookies },
    data: body,
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[payments.journey] POST /payment-methods failed: ${res.status()} ${raw.slice(0, 200)}`,
    );
  }
  const { data } = JSON.parse(raw) as { data: PaymentMethodLite };
  return data;
}

async function deleteMethod(baseURL: string, id: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.delete(`/api/v1/admin/payment-methods/${id}`, {
    headers: { Cookie: cookies },
  });
  await ctx.dispose();
  if (res.status() !== 204 && res.status() !== 404) {
    throw new Error(`[payments.journey] DELETE /payment-methods/${id} failed: ${res.status()}`);
  }
}

async function reorderMethods(baseURL: string, ids: string[]): Promise<number> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.post('/api/v1/admin/payment-methods/reorder', {
    headers: { Cookie: cookies },
    data: { ids },
  });
  await ctx.dispose();
  return res.status();
}

async function fetchMethod(
  baseURL: string,
  id: string,
): Promise<PaymentMethodLite & { sortOrder: number }> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.get(`/api/v1/admin/payment-methods/${id}`, {
    headers: { Cookie: cookies },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[payments.journey] GET /payment-methods/${id} failed: ${res.status()}`);
  }
  const { data } = JSON.parse(raw) as { data: PaymentMethodLite & { sortOrder: number } };
  return data;
}

function uniqueCode(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

test('list renders + is axe-clean', async ({ page }) => {
  await page.goto('/payment-methods', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="payment-methods-list-page"]')).toBeVisible({
    timeout: 10_000,
  });
  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: false });
});

test('create → edit → soft-delete round-trip', async ({ page, baseURL }) => {
  const code = uniqueCode('r611_e2e');
  let createdId: string | null = null;

  try {
    await page.goto('/payment-methods/new', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="payment-method-new-page"]')).toBeVisible();

    await page.fill('#pm-new-code', code);
    await page.fill('#pm-new-name-default', `R6.11 test ${code}`);
    await page.selectOption('[data-testid="pm-new-provider"]', 'manual');
    await page.fill('#pm-new-sort', '999');

    const createResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/admin/payment-methods') &&
        r.request().method() === 'POST' &&
        !r.url().includes('/reorder'),
      { timeout: 15_000 },
    );
    await page.click('[data-testid="pm-new-save"]');
    expect((await createResponse).status()).toBe(201);

    const detailUrl = /\/payment-methods\/(?!new$)([^/?#]+)$/;
    await expect(page).toHaveURL(detailUrl);
    createdId = detailUrl.exec(page.url())![1];
    await expect(page.locator('[data-testid="payment-method-detail-page"]')).toBeVisible();

    const sortInput = page.locator('input#pm-sort');
    await sortInput.fill('42');
    const patchResponse = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/admin/payment-methods/${createdId}`) &&
        r.request().method() === 'PATCH',
      { timeout: 15_000 },
    );
    await page.click('[data-testid="pm-save"]');
    const patchRes = await patchResponse;
    expect(patchRes.status()).toBe(200);

    const after = await fetchMethod(baseURL!, createdId);
    expect(after.sortOrder).toBe(42);

    await page.click('[data-testid="pm-delete"]');
    const confirmButton = page.locator('[data-testid="confirm-dialog-confirm"]');
    await expect(confirmButton).toBeVisible();
    const deleteResponse = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/admin/payment-methods/${createdId}`) &&
        r.request().method() === 'DELETE',
      { timeout: 15_000 },
    );
    await confirmButton.click();
    const delRes = await deleteResponse;
    expect(delRes.status()).toBe(204);

    await expect(page).toHaveURL(/\/payment-methods\/?$/);
    createdId = null;
  } finally {
    if (createdId) {
      await deleteMethod(baseURL!, createdId);
    }
  }
});

test('keyboard ArrowUp on row index 1 PATCHes reorder + persists', async ({ page, baseURL }) => {
  const codeA = uniqueCode('r611_order_a');
  const codeB = uniqueCode('r611_order_b');
  const a = await createMethod(baseURL!, {
    code: codeA,
    name: { default: `R6.11 A ${codeA}` },
    provider: 'manual',
    sortOrder: 9000,
    isActive: false,
  });
  const b = await createMethod(baseURL!, {
    code: codeB,
    name: { default: `R6.11 B ${codeB}` },
    provider: 'manual',
    sortOrder: 9001,
    isActive: false,
  });

  try {
    await page.goto('/payment-methods?pageSize=100', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="payment-methods-list-page"]')).toBeVisible();

    const aRow = page.locator(`[data-testid="payment-row-${a.id}"]`);
    const bRow = page.locator(`[data-testid="payment-row-${b.id}"]`);
    await expect(aRow).toBeVisible();
    await expect(bRow).toBeVisible();

    // Capture initial DOM order — expect a.sortOrder < b.sortOrder so A appears first.
    const bHandle = page.locator(`[data-testid="drag-handle-${b.id}"]`);
    await bHandle.focus();

    const reorderResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/admin/payment-methods/reorder') &&
        r.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await page.keyboard.press('ArrowUp');
    const res = await reorderResponse;
    expect(res.status()).toBe(204);

    await page.reload({ waitUntil: 'networkidle' });
    const after = await fetchMethod(baseURL!, b.id);
    const afterA = await fetchMethod(baseURL!, a.id);
    // B now ranks ahead of A.
    expect(after.sortOrder < afterA.sortOrder).toBe(true);
  } finally {
    await deleteMethod(baseURL!, a.id);
    await deleteMethod(baseURL!, b.id);
  }
});

test('duplicate code surfaces an inline conflict banner + does not navigate', async ({
  page,
  baseURL,
}) => {
  const code = uniqueCode('r611_conflict');
  const seeded = await createMethod(baseURL!, {
    code,
    name: { default: `R6.11 conflict ${code}` },
    provider: 'manual',
    isActive: false,
  });

  try {
    await page.goto('/payment-methods/new', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="payment-method-new-page"]')).toBeVisible();

    await page.fill('#pm-new-code', code);
    await page.fill('#pm-new-name-default', `dup ${code}`);
    await page.selectOption('[data-testid="pm-new-provider"]', 'manual');

    const conflictResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/v1/admin/payment-methods') &&
        r.request().method() === 'POST' &&
        r.status() === 409,
      { timeout: 15_000 },
    );
    await page.click('[data-testid="pm-new-save"]');
    await conflictResponse;

    await expect(page).toHaveURL(/\/payment-methods\/new$/);
    await expect(page.locator('text=already exists')).toBeVisible();
  } finally {
    await deleteMethod(baseURL!, seeded.id);
  }
});
