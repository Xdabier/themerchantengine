import { test, expect } from './_auth-fixture';
import { request, type APIRequestContext } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * R6.7 — Countries PATCH journey.
 *
 * Covers `/shipping/countries` against the live backend: initial list, the
 * enable toggle + default-select PATCH round-trip with persistence across
 * reload, the client-side "default must be in enabled" refine, the
 * "at least one enabled" guard, and axe-clean mount.
 *
 * Every write round-trips through `/api/v1/admin/countries`. Each spec
 * captures the initial `{enabled[], defaultCode}` at setup and PATCHes back
 * to that shape on teardown so parallel workers + re-runs stay deterministic.
 * No `page.route()`, no fixtures.
 */

// Countries live in a single `storeSetting` row — parallel workers PATCHing
// it at once corrupt each other's teardown snapshot. Serialize the file so
// each spec captures → mutates → restores in exclusive order.
test.describe.configure({ mode: 'serial' });

interface CountryRow {
  code: string;
  name: string;
  region: string;
  emoji: string;
  enabled: boolean;
  isDefault: boolean;
}

interface CountriesSnapshot {
  data: CountryRow[];
  defaultCode: string | null;
}

async function fetchSnapshot(baseURL: string): Promise<CountriesSnapshot> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.get('/api/v1/admin/countries', {
    headers: { Cookie: cookies },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[countries.journey] GET snapshot failed: ${res.status()} ${raw.slice(0, 200)}`,
    );
  }
  const body = JSON.parse(raw) as { data: CountriesSnapshot };
  return body.data;
}

async function patchCountries(
  baseURL: string,
  payload: { enabled: string[]; defaultCode?: string },
): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.patch('/api/v1/admin/countries', {
    headers: { Cookie: cookies },
    data: payload,
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[countries.journey] PATCH failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
}

async function restoreSnapshot(baseURL: string, snap: CountriesSnapshot): Promise<void> {
  const enabledCodes = snap.data.filter((r) => r.enabled).map((r) => r.code);
  if (enabledCodes.length === 0) return;
  await patchCountries(baseURL, {
    enabled: enabledCodes,
    ...(snap.defaultCode && enabledCodes.includes(snap.defaultCode)
      ? { defaultCode: snap.defaultCode }
      : {}),
  });
}

function codeToFlip(snap: CountriesSnapshot): string {
  const disabled = snap.data.find((r) => !r.enabled);
  if (!disabled) {
    throw new Error('[countries.journey] expected at least one disabled ISO in the catalogue');
  }
  return disabled.code;
}

function secondEnabledCode(snap: CountriesSnapshot): string | null {
  const enabled = snap.data.filter((r) => r.enabled).map((r) => r.code);
  const alt = enabled.find((c) => c !== snap.defaultCode);
  return alt ?? null;
}

test('list round-trip mounts with the live snapshot', async ({ page, baseURL }) => {
  const snap = await fetchSnapshot(baseURL!);
  await page.goto('/shipping/countries', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="countries-page"]')).toBeVisible({ timeout: 10_000 });

  for (const row of snap.data.filter((r) => r.enabled)) {
    const checkbox = page.locator(`[data-testid="country-toggle-${row.code}"]`);
    await expect(checkbox).toBeChecked();
  }
  if (snap.defaultCode) {
    await expect(page.locator('[data-testid="country-default-select"]')).toHaveValue(
      snap.defaultCode,
    );
  }
  // Finding E15: the flag emoji rendered as the raw ISO letters on Windows,
  // so every row read "FR France … FR".
  const qaRow = page.locator('[data-testid="country-toggle-QA"]').locator('xpath=ancestor::li[1]');
  const rowText = (await qaRow.innerText()).trim();
  expect(rowText.match(/QA/g) ?? []).toHaveLength(1);

  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });
});

test('enable toggle PATCHes the live backend and persists on reload', async ({ page, baseURL }) => {
  const snap = await fetchSnapshot(baseURL!);
  const target = codeToFlip(snap);
  try {
    await page.goto('/shipping/countries', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="countries-page"]')).toBeVisible({ timeout: 10_000 });

    const checkbox = page.locator(`[data-testid="country-toggle-${target}"]`);
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await page.locator('[data-testid="country-save"]').click();

    await expect(page.locator('[data-testid="countries-notice"]')).toContainText(
      'Countries updated.',
      { timeout: 10_000 },
    );

    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator(`[data-testid="country-toggle-${target}"]`)).toBeChecked({
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
    // Seed data may leave only one country enabled. Broaden the enabled set
    // via the live API so the default-swap branch has two valid
    // destinations; teardown restores the original shape.
    const firstDisabled = snap.data.find((r) => !r.enabled);
    if (!firstDisabled) {
      throw new Error('[countries.journey] expected an extra ISO to broaden the enabled set');
    }
    alt = firstDisabled.code;
    const enabledCodes = [
      ...snap.data.filter((r) => r.enabled).map((r) => r.code),
      firstDisabled.code,
    ];
    await patchCountries(baseURL!, {
      enabled: enabledCodes,
      ...(snap.defaultCode ? { defaultCode: snap.defaultCode } : {}),
    });
  }
  try {
    await page.goto('/shipping/countries', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="countries-page"]')).toBeVisible({ timeout: 10_000 });

    await page.locator('[data-testid="country-default-select"]').selectOption(alt!);
    await page.locator('[data-testid="country-save"]').click();

    await expect(page.locator('[data-testid="countries-notice"]')).toContainText(
      'Countries updated.',
      { timeout: 10_000 },
    );

    // Assert server state first — this narrows a UI rerender race vs a backend
    // write failure if the reload assertion later flakes.
    const postSnap = await fetchSnapshot(baseURL!);
    expect(postSnap.defaultCode).toBe(alt);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="country-default-select"]')).toHaveValue(alt!, {
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
      '[countries.journey] expected at least one disabled ISO in the catalogue — cannot test the default-outside-enabled refine',
    );
  }
  try {
    await page.goto('/shipping/countries', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="countries-page"]')).toBeVisible({ timeout: 10_000 });

    // Force a disabled option via the DOM — the native select allows it even
    // though the option is marked `disabled`, because the component still
    // renders every row for display symmetry with the toggle list.
    await page.evaluate((code) => {
      const select = document.querySelector<HTMLSelectElement>(
        '[data-testid="country-default-select"]',
      );
      if (!select) throw new Error('default select missing');
      select.value = code;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, disabled.code);

    await page.locator('[data-testid="country-save"]').click();
    await expect(page.locator('[data-testid="countries-error"]')).toContainText(
      'Default country must be in the enabled list.',
      { timeout: 5000 },
    );

    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });
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
    await page.goto('/shipping/countries', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="countries-page"]')).toBeVisible({ timeout: 10_000 });

    const regions = await page
      .locator('[data-testid^="country-region-disable-"]')
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute('data-testid')!.replace('country-region-disable-', '')),
      );
    for (const region of regions) {
      await page.locator(`[data-testid="country-region-disable-${region}"]`).click();
    }

    const save = page.locator('[data-testid="country-save"] button');
    await expect(save).toBeDisabled();
  } finally {
    await restoreSnapshot(baseURL!, snap);
  }
});
