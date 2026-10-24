import { test, expect } from './_auth-fixture';
import { request } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { assertNoObjectObjectLeak, getAdminCookies } from './_helpers';

/**
 * R5.5 — Shipping zones + methods + carrier-create admin journey.
 *
 * Covers `/shipping/zones` (list + editor + 404 on missing), `/shipping/methods`
 * (list + filter + editor per type + soft-delete), `/shipping/carriers/new`
 * (validation + 409 handling). Live backend. No `page.route()`, no MSW, no
 * fixtures.
 *
 * KNOWN: zones cannot be deleted (backend exposes no endpoint). Tests use
 * timestamped default names to avoid false-positive accumulation asserts.
 */

function stamp(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function seedZone(
  baseURL: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; name: { default: string }; countries: string[] }> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const defaultName = `E2E Zone ${stamp()}`;
  const res = await ctx.post('/api/v1/admin/shipping/zones', {
    headers: { Cookie: cookies },
    data: {
      name: { default: defaultName },
      countries: ['QA', 'SA'],
      priority: 0,
      isActive: true,
      ...overrides,
    },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[shipping.journey] seed zone failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
  const { data } = JSON.parse(raw) as {
    data: { id: string; name: { default: string }; countries: string[] };
  };
  return data;
}

async function seedMethod(
  baseURL: string,
  zoneId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; zoneId: string; name: { default: string }; type: string }> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const defaultName = `E2E Method ${stamp()}`;
  const res = await ctx.post('/api/v1/admin/shipping/methods', {
    headers: { Cookie: cookies },
    data: {
      zoneId,
      name: { default: defaultName },
      type: 'FLAT_RATE',
      price: 20,
      isActive: true,
      ...overrides,
    },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[shipping.journey] seed method failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
  const { data } = JSON.parse(raw) as {
    data: { id: string; zoneId: string; name: { default: string }; type: string };
  };
  return data;
}

async function deleteMethodViaApi(baseURL: string, id: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  await ctx.delete(`/api/v1/admin/shipping/methods/${id}`, {
    headers: { Cookie: cookies },
  });
  await ctx.dispose();
}

/**
 * Retire a method this spec created through the UI.
 *
 * The four editor journeys below had no cleanup at all: the API-seeded methods
 * were deleted in a `finally`, but anything the form itself persisted stayed
 * forever. That is why the dev database ended up with 63 `E2E ...` methods, and
 * why these very specs had to start passing `pageSize=100` to keep their own
 * new row on page one. The name is stamped, so it identifies exactly one row.
 *
 * Best-effort by design: a failing cleanup must not turn a passing journey red,
 * and the admin teardown sweep is the backstop for anything missed here.
 */
async function deleteMethodByName(baseURL: string, name: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  try {
    const res = await ctx.get('/api/v1/admin/shipping/methods?pageSize=100', {
      headers: { Cookie: cookies },
    });
    if (!res.ok()) return;
    const body = (await res.json()) as { data?: { id: string; name: { default: string } }[] };
    const match = body.data?.find((m) => m.name?.default === name);
    if (!match) return;
    await ctx.delete(`/api/v1/admin/shipping/methods/${match.id}`, {
      headers: { Cookie: cookies },
    });
  } catch {
    // best-effort
  } finally {
    await ctx.dispose();
  }
}

test.describe('shipping zones journey', () => {
  test('/shipping/zones mounts, is a11y-clean, shows seeded zone', async ({ page, baseURL }) => {
    const seed = await seedZone(baseURL!);
    // Navigate with the API-maximum pageSize (100) so accumulation of non-deletable
    // E2E zones (backend exposes no DELETE /zones endpoint) does not push the newly
    // created zone off the first page. 100 is the backend's max pageSize per
    // the validation constraint in the shipping zones list endpoint.
    await page.goto('/shipping/zones?pageSize=100', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="shipping-zones-list-page"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator(`[data-testid="zone-row-${seed.id}"]`)).toBeVisible();
    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });
  });

  test('/shipping/zones/new rejects empty + non-ISO countries; persists on valid', async ({
    page,
    baseURL,
  }) => {
    await page.goto('/shipping/zones/new', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="shipping-zone-editor-page"]')).toBeVisible();

    // Empty countries → submit disabled until a country lands
    await page.locator('input#zone-name-default').fill(`E2E Zone ${stamp()}`);
    await expect(page.locator('[data-testid="zone-save"] button')).toBeDisabled();

    // Non-ISO (lowercase) gets rejected by the ISO allowlist
    const countryInput = page.locator('input#zone-country-input');
    await countryInput.fill('qa');
    await countryInput.press('Enter');
    await expect(page.locator('[data-testid="zone-country-chip-QA"]')).toHaveCount(0);

    // Valid ISO
    await countryInput.fill('QA');
    await countryInput.press('Enter');
    await expect(page.locator('[data-testid="zone-country-chip-QA"]')).toBeVisible();

    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });

    await page.locator('[data-testid="zone-save"]').click();
    await page.waitForURL('**/shipping/zones', { timeout: 10_000 });
  });

  test('/shipping/zones/:id/edit toggles isActive and saves', async ({ page, baseURL }) => {
    const seed = await seedZone(baseURL!);
    await page.goto(`/shipping/zones/${seed.id}/edit`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="shipping-zone-editor-page"]')).toBeVisible();

    const toggle = page.locator('[data-testid="zone-isactive"]');
    const before = await toggle.isChecked();
    await toggle.click();
    await expect(toggle).toBeChecked({ checked: !before });

    await page.locator('[data-testid="zone-save"]').click();
    await page.waitForURL('**/shipping/zones', { timeout: 10_000 });
  });

  test('/shipping/zones/:id/edit on unknown id renders error banner', async ({ page }) => {
    await page.goto('/shipping/zones/zzzzmissingidzzzzzz/edit', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="shipping-zone-editor-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="zone-error"]')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('shipping methods journey', () => {
  test('/shipping/methods list mounts with filter + row visible', async ({ page, baseURL }) => {
    const zone = await seedZone(baseURL!);
    const m = await seedMethod(baseURL!, zone.id);
    try {
      // Navigate with pageSize=100 (API max) so accumulated non-deleted E2E methods
      // from previous runs do not push the newly created method off page 1.
      await page.goto('/shipping/methods?pageSize=100', { waitUntil: 'networkidle' });
      await expect(page.locator('[data-testid="shipping-methods-list-page"]')).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.locator('[data-testid="methods-zone-filter"]')).toBeVisible();
      await expect(page.locator(`[data-testid="method-row-${m.id}"]`)).toBeVisible();
      await injectAxe(page);
      await checkA11y(page, undefined, { detailedReport: true });
    } finally {
      await deleteMethodViaApi(baseURL!, m.id);
    }
  });

  test('/shipping/methods names every zone, so same-named methods differ', async ({
    page,
    baseURL,
  }) => {
    const zone = await seedZone(baseURL!);
    const m = await seedMethod(baseURL!, zone.id);
    try {
      await page.goto('/shipping/methods?pageSize=100', { waitUntil: 'networkidle' });
      await expect(page.locator(`[data-testid="method-row-${m.id}"]`)).toBeVisible({
        timeout: 10_000,
      });

      // The ZONE column resolved through a truncated pageSize=100 client join,
      // so real zones fell outside page one and dashed (finding F8).
      const zoneCells = page.locator('[data-testid^="method-zone-"]');
      const zoneNames = await zoneCells.allInnerTexts();
      expect(zoneNames.length).toBeGreaterThan(0);
      for (const text of zoneNames) {
        expect(text.trim()).not.toBe('—');
      }

      // Zone names are Translatable; binding the object raw would leak here.
      await assertNoObjectObjectLeak(page);

      // Finding F9: rows sharing a name must still be told apart.
      const rowTexts = await page.locator('[data-testid^="method-row-"]').allInnerTexts();
      const standards = rowTexts.filter((t) => t.includes('Standard Delivery'));
      if (standards.length > 1) {
        expect(new Set(standards).size).toBe(standards.length);
      }
    } finally {
      await deleteMethodViaApi(baseURL!, m.id);
    }
  });

  test('/shipping/methods/new swaps config blocks on type change (FLAT→WEIGHT→PRICE→FREE→CARRIER)', async ({
    page,
    baseURL,
  }) => {
    const zone = await seedZone(baseURL!);
    await page.goto('/shipping/methods/new', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="shipping-method-editor-page"]')).toBeVisible();

    await page.locator('select#method-zone').selectOption(zone.id);

    // FLAT_RATE default: price visible, ranges hidden
    await page.locator('select#method-type').selectOption('FLAT_RATE');
    await expect(page.locator('[data-testid="method-price-block"]')).toBeVisible();
    await expect(page.locator('[data-testid="method-weight-block"]')).toHaveCount(0);

    // WEIGHT_BASED: weight repeater shown, price hidden
    await page.locator('select#method-type').selectOption('WEIGHT_BASED');
    await expect(page.locator('[data-testid="method-weight-block"]')).toBeVisible();
    await expect(page.locator('[data-testid="method-price-block"]')).toHaveCount(0);

    // PRICE_BASED
    await page.locator('select#method-type').selectOption('PRICE_BASED');
    await expect(page.locator('[data-testid="method-price-range-block"]')).toBeVisible();
    await expect(page.locator('[data-testid="method-weight-block"]')).toHaveCount(0);

    // FREE
    await page.locator('select#method-type').selectOption('FREE');
    await expect(page.locator('[data-testid="method-price-range-block"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="method-weight-block"]')).toHaveCount(0);

    // CARRIER_CALCULATED
    await page.locator('select#method-type').selectOption('CARRIER_CALCULATED');
    await expect(page.locator('[data-testid="method-price-range-block"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="method-weight-block"]')).toHaveCount(0);
  });

  test('/shipping/methods/new persists a FLAT_RATE method', async ({ page, baseURL }) => {
    const zone = await seedZone(baseURL!);
    const name = `E2E FLAT ${stamp()}`;
    try {
      await page.goto('/shipping/methods/new', { waitUntil: 'networkidle' });
      await page.locator('select#method-zone').selectOption(zone.id);
      await page.locator('input#method-name-default').fill(name);
      await page.locator('select#method-type').selectOption('FLAT_RATE');
      await page.locator('input#method-price').fill('12.50');
      await page.locator('[data-testid="method-save"]').click();
      await page.waitForURL('**/shipping/methods', { timeout: 10_000 });
    } finally {
      await deleteMethodByName(baseURL!, name);
    }
  });

  test('/shipping/methods/new persists a WEIGHT_BASED method with two ranges + a11y after row add', async ({
    page,
    baseURL,
  }) => {
    const zone = await seedZone(baseURL!);
    const name = `E2E WEIGHT ${stamp()}`;
    try {
      await page.goto('/shipping/methods/new', { waitUntil: 'networkidle' });
      await page.locator('select#method-zone').selectOption(zone.id);
      await page.locator('input#method-name-default').fill(name);
      await page.locator('select#method-type').selectOption('WEIGHT_BASED');

      await page.locator('[data-testid="method-weight-add"]').click();
      await page.locator('input#method-weight-0-min').fill('0');
      await page.locator('input#method-weight-0-max').fill('5');
      await page.locator('input#method-weight-0-price').fill('10');

      await page.locator('[data-testid="method-weight-add"]').click();
      await page.locator('input#method-weight-1-min').fill('5');
      await page.locator('input#method-weight-1-max').fill('20');
      await page.locator('input#method-weight-1-price').fill('25');

      await injectAxe(page);
      await checkA11y(page, undefined, { detailedReport: true });

      await page.locator('[data-testid="method-save"]').click();
      await page.waitForURL('**/shipping/methods', { timeout: 10_000 });
    } finally {
      await deleteMethodByName(baseURL!, name);
    }
  });

  test('/shipping/methods/new persists a PRICE_BASED method with a range', async ({
    page,
    baseURL,
  }) => {
    const zone = await seedZone(baseURL!);
    const name = `E2E PRICE ${stamp()}`;
    try {
      await page.goto('/shipping/methods/new', { waitUntil: 'networkidle' });
      await page.locator('select#method-zone').selectOption(zone.id);
      await page.locator('input#method-name-default').fill(name);
      await page.locator('select#method-type').selectOption('PRICE_BASED');

      await page.locator('[data-testid="method-price-range-add"]').click();
      await page.locator('input#method-price-range-0-min').fill('0');
      await page.locator('input#method-price-range-0-max').fill('200');
      await page.locator('input#method-price-range-0-price').fill('8');

      await page.locator('[data-testid="method-save"]').click();
      await page.waitForURL('**/shipping/methods', { timeout: 10_000 });
    } finally {
      await deleteMethodByName(baseURL!, name);
    }
  });

  test('/shipping/methods/new persists a CARRIER_CALCULATED method', async ({ page, baseURL }) => {
    const zone = await seedZone(baseURL!);
    const name = `E2E CARRIER ${stamp()}`;
    try {
      await page.goto('/shipping/methods/new', { waitUntil: 'networkidle' });
      await page.locator('select#method-zone').selectOption(zone.id);
      await page.locator('input#method-name-default').fill(name);
      await page.locator('select#method-type').selectOption('CARRIER_CALCULATED');
      await page.locator('[data-testid="method-save"]').click();
      await page.waitForURL('**/shipping/methods', { timeout: 10_000 });
    } finally {
      await deleteMethodByName(baseURL!, name);
    }
  });

  test('/shipping/methods/:id/edit keeps Save disabled until something changes', async ({
    page,
    baseURL,
  }) => {
    // QA C7: a prefilled edit form that enables Save on load invites a no-op
    // write and makes "did I change anything?" unanswerable.
    const zone = await seedZone(baseURL!);
    const m = await seedMethod(baseURL!, zone.id);
    try {
      await page.goto(`/shipping/methods/${m.id}/edit`, { waitUntil: 'networkidle' });

      const save = page.locator('[data-testid="method-save"] button');
      await expect(save).toBeDisabled();
      await expect(page.locator('[data-testid="method-dirty"]')).toHaveText('No changes');

      await page.locator('input#method-name-default').fill(`E2E RENAMED ${stamp()}`);
      await expect(page.locator('[data-testid="method-dirty"]')).toHaveText('Unsaved changes');
      await expect(save).toBeEnabled();
    } finally {
      // The rename is never saved, so the row still carries its seeded name.
      await deleteMethodViaApi(baseURL!, m.id);
    }
  });

  test('/shipping/methods/:id disable flow soft-deactivates', async ({ page, baseURL }) => {
    const zone = await seedZone(baseURL!);
    const m = await seedMethod(baseURL!, zone.id);
    await page.goto(`/shipping/methods/${m.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="shipping-method-detail-page"]')).toBeVisible();
    await page.locator('[data-testid="method-disable"]').click();
    await page.locator('[data-testid="confirm-dialog-confirm"]').click();
    await page.waitForURL('**/shipping/methods', { timeout: 10_000 });
  });
});

test.describe('carrier create journey', () => {
  test('/shipping/carriers/new rejects uppercase code; persists a valid one', async ({
    page,
    baseURL,
  }) => {
    await page.goto('/shipping/carriers/new', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="carrier-new-page"]')).toBeVisible();

    // Uppercase → rejected
    await page.locator('input#car-code').fill('DHL');
    await page.locator('input#car-code').blur();
    await expect(page.locator('[data-testid="car-save"] button')).toBeDisabled();

    // Valid
    const code = `e2e_car_${Date.now().toString(36)}`;
    await page.locator('input#car-code').fill(code);
    await page.locator('input#car-name-default').fill(`E2E Carrier ${stamp()}`);
    await page.locator('select#car-provider').selectOption('manual');

    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });

    await page.locator('[data-testid="car-save"]').click();
    await page.waitForURL('**/shipping/carriers/**', { timeout: 10_000 });
  });
});
