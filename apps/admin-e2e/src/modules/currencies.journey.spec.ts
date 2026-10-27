import { test, expect } from './_auth-fixture';
import { request, type APIRequestContext } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * R6.6 — Currencies PATCH journey.
 *
 * Covers `/currencies` against the live backend: initial list, the enable
 * toggle + default-select PATCH round-trip with persistence across reload,
 * the client-side "default must be in enabled" refine, the "at least one
 * enabled" guard, and axe-clean mount.
 *
 * Every write round-trips through `/api/v1/admin/currencies`. Each spec
 * captures the initial `{enabled[], defaultCode}` at setup and PATCHes back
 * to that shape on teardown so parallel workers + re-runs stay deterministic.
 * No `page.route()`, no fixtures.
 */

// Currencies live in a single `storeSetting` row — parallel workers PATCHing
// it at once corrupt each other's teardown snapshot. Serialize the file so
// each spec captures → mutates → restores in exclusive order.
test.describe.configure({ mode: 'serial' });

interface CurrencyRow {
  code: string;
  name: string;
  symbol: string;
  region: string;
  decimalPlaces: number;
  enabled: boolean;
  isDefault: boolean;
}

interface CurrenciesSnapshot {
  data: CurrencyRow[];
  defaultCode: string | null;
}

async function fetchSnapshot(baseURL: string): Promise<CurrenciesSnapshot> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.get('/api/v1/admin/currencies', {
    headers: { Cookie: cookies },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[currencies.journey] GET snapshot failed: ${res.status()} ${raw.slice(0, 200)}`,
    );
  }
  const body = JSON.parse(raw) as { data: CurrenciesSnapshot };
  return body.data;
}

async function patchCurrencies(
  baseURL: string,
  payload: { enabled: string[]; defaultCode?: string },
): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.patch('/api/v1/admin/currencies', {
    headers: { Cookie: cookies },
    data: payload,
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[currencies.journey] PATCH failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
}

async function restoreSnapshot(baseURL: string, snap: CurrenciesSnapshot): Promise<void> {
  const enabledCodes = snap.data.filter((r) => r.enabled).map((r) => r.code);
  if (enabledCodes.length === 0) {
    // Snapshot was empty — shouldn't happen in practice, but skip rather than
    // 400 the backend.
    return;
  }
  await patchCurrencies(baseURL, {
    enabled: enabledCodes,
    ...(snap.defaultCode && enabledCodes.includes(snap.defaultCode)
      ? { defaultCode: snap.defaultCode }
      : {}),
  });
}

function codeToFlip(snap: CurrenciesSnapshot): string {
  const disabled = snap.data.find((r) => !r.enabled);
  if (!disabled) {
    throw new Error('[currencies.journey] expected at least one disabled ISO in the catalogue');
  }
  return disabled.code;
}

function secondEnabledCode(snap: CurrenciesSnapshot): string | null {
  const enabled = snap.data.filter((r) => r.enabled).map((r) => r.code);
  const alt = enabled.find((c) => c !== snap.defaultCode);
  return alt ?? null;
}

test('list round-trip mounts with the live snapshot', async ({ page, baseURL }) => {
  const snap = await fetchSnapshot(baseURL!);
  await page.goto('/currencies', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="currencies-page"]')).toBeVisible({ timeout: 10_000 });

  for (const row of snap.data.filter((r) => r.enabled)) {
    const checkbox = page.locator(`[data-testid="currency-toggle-${row.code}"]`);
    await expect(checkbox).toBeChecked();
  }
  if (snap.defaultCode) {
    await expect(page.locator('[data-testid="currency-default-select"]')).toHaveValue(
      snap.defaultCode,
    );
  }
  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });
});

test('enable toggle PATCHes the live backend and persists on reload', async ({ page, baseURL }) => {
  const snap = await fetchSnapshot(baseURL!);
  const target = codeToFlip(snap);
  try {
    await page.goto('/currencies', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="currencies-page"]')).toBeVisible({ timeout: 10_000 });

    const checkbox = page.locator(`[data-testid="currency-toggle-${target}"]`);
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await page.locator('[data-testid="currency-save"]').click();

    await expect(page.locator('[data-testid="currencies-notice"]')).toContainText(
      'Currencies updated.',
      { timeout: 10_000 },
    );

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator(`[data-testid="currency-toggle-${target}"]`)).toBeChecked({
      timeout: 10_000,
    });

    const postSnap = await fetchSnapshot(baseURL!);
    expect(postSnap.data.find((r) => r.code === target)?.enabled).toBe(true);
  } finally {
    await restoreSnapshot(baseURL!, snap);
  }
});

test('setting a new default PATCHes and persists on reload', async ({ page, baseURL }) => {
  const snap = await fetchSnapshot(baseURL!);
  let alt = secondEnabledCode(snap);
  if (alt === null) {
    // Seed data may leave only one currency enabled. Broaden the enabled
    // set via the live API so the default-swap branch has two valid
    // destinations; teardown restores the original shape.
    const firstDisabled = snap.data.find((r) => !r.enabled);
    if (!firstDisabled) {
      throw new Error('[currencies.journey] expected an extra ISO to broaden the enabled set');
    }
    alt = firstDisabled.code;
    const enabledCodes = [
      ...snap.data.filter((r) => r.enabled).map((r) => r.code),
      firstDisabled.code,
    ];
    await patchCurrencies(baseURL!, {
      enabled: enabledCodes,
      ...(snap.defaultCode ? { defaultCode: snap.defaultCode } : {}),
    });
  }
  try {
    await page.goto('/currencies', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="currencies-page"]')).toBeVisible({ timeout: 10_000 });

    await page.locator('[data-testid="currency-default-select"]').selectOption(alt!);
    await page.locator('[data-testid="currency-save"]').click();

    await expect(page.locator('[data-testid="currencies-notice"]')).toContainText(
      'Currencies updated.',
      { timeout: 10_000 },
    );

    // Assert server state first — this narrows a UI rerender race vs a
    // backend write failure if the reload assertion later flakes.
    const postSnap = await fetchSnapshot(baseURL!);
    expect(postSnap.defaultCode).toBe(alt);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="currency-default-select"]')).toHaveValue(alt!, {
      timeout: 10_000,
    });
  } finally {
    await restoreSnapshot(baseURL!, snap);
  }
});

test('default outside the enabled set is refused client-side', async ({ page, baseURL }) => {
  const snap = await fetchSnapshot(baseURL!);
  const disabled = snap.data.find((r) => !r.enabled);
  if (!disabled) {
    throw new Error(
      '[currencies.journey] expected at least one disabled ISO in the catalogue — cannot test the default-outside-enabled refine',
    );
  }
  try {
    await page.goto('/currencies', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="currencies-page"]')).toBeVisible({ timeout: 10_000 });

    // Pick a disabled option via the DOM — the native select allows it even
    // though the option is marked `disabled`, because the component still
    // renders every row for display symmetry with the toggle list.
    await page.evaluate((code) => {
      const select = document.querySelector<HTMLSelectElement>(
        '[data-testid="currency-default-select"]',
      );
      if (!select) throw new Error('default select missing');
      select.value = code;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, disabled.code);

    await page.locator('[data-testid="currency-save"]').click();
    await expect(page.locator('[data-testid="currencies-error"]')).toContainText(
      'Default currency must be in the enabled list.',
      { timeout: 5000 },
    );
  } finally {
    await restoreSnapshot(baseURL!, snap);
  }
});

test('empty-enabled guard surfaces the branded error and blocks save', async ({
  page,
  baseURL,
}) => {
  const snap = await fetchSnapshot(baseURL!);
  try {
    await page.goto('/currencies', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="currencies-page"]')).toBeVisible({ timeout: 10_000 });

    const regions = await page
      .locator('[data-testid^="currency-region-disable-"]')
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute('data-testid')!.replace('currency-region-disable-', '')),
      );
    for (const region of regions) {
      await page.locator(`[data-testid="currency-region-disable-${region}"]`).click();
    }

    const save = page.locator('[data-testid="currency-save"] button');
    await expect(save).toBeDisabled();
  } finally {
    await restoreSnapshot(baseURL!, snap);
  }
});
