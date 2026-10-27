import { test, expect } from './_auth-fixture';
import { request } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * Plan E3 gate B: the runtime-config settings screens, against the real API.
 *
 * Every screen here edits a store singleton, so every journey restores what it
 * changed. The restore goes through the API rather than through the screen,
 * because a restore that uses the thing under test reports success when the
 * thing under test is broken.
 *
 * The viewport matrix runs per screen instead of once: these are two-column
 * grids and sticky footers, and a save button that scrolls under the fold on a
 * 360 px phone is a screen that cannot be saved.
 */
const VIEWPORTS = [
  { width: 360, height: 780, name: 'phone' },
  { width: 768, height: 1024, name: 'tablet' },
  { width: 1440, height: 900, name: 'desktop' },
] as const;

type Groups = Record<string, Record<string, unknown>>;

async function readSettings(baseURL: string): Promise<Groups> {
  const ctx = await request.newContext({ baseURL });
  // Admin reads always carry `X-Resolve-Locale: false` (docs/admin-api-reference.md
  // §57-58, §3871): the real admin app defaults `ADMIN_RAW_LOCALE` to true on
  // every request. Without it, Translatable fields like `legalName` collapse to a
  // resolved string, and restoring that string through PATCH 400s because the DTO
  // expects the per-locale object.
  const res = await ctx.get('/api/v1/admin/settings', {
    headers: { Cookie: getAdminCookies(baseURL), 'X-Resolve-Locale': 'false' },
  });
  const body = (await res.json()) as { data: Groups };
  await ctx.dispose();
  return body.data;
}

async function patchSettings(baseURL: string, data: Record<string, unknown>): Promise<void> {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.patch('/api/v1/admin/settings', {
    headers: { Cookie: getAdminCookies(baseURL) },
    data,
  });
  const ok = res.ok();
  const detail = ok ? '' : `${res.status()} ${await res.text()}`;
  await ctx.dispose();
  if (!ok) throw new Error(`[settings-config.journey] restore failed: ${detail}`);
}

async function openSettings(page: import('@playwright/test').Page, path: string, testId: string) {
  await page.goto(path, { waitUntil: 'networkidle' });
  await expect(page, `not authenticated: this is the login page, not ${path}`).not.toHaveURL(
    /\/auth\/login/,
  );
  await expect(page.locator(`[data-testid="${testId}"]`), `${path} never mounted`).toBeVisible({
    timeout: 15_000,
  });
}

test('settings-brand: a colour saves, previews its palette, and restores', async ({
  page,
  baseURL,
}) => {
  const before = await readSettings(baseURL!);
  const originalColors = before['brand']?.['baseColors'] as Record<string, unknown> | undefined;

  try {
    await openSettings(page, '/settings/brand', 'settings-brand-page');

    // The preview is the generator's own output, not a mock of it.
    await expect(page.locator('[data-testid="settings-brand-palette"]')).toBeVisible();
    const swatches = page.locator('[data-testid="settings-brand-palette"] li');
    expect(await swatches.count()).toBeGreaterThan(10);

    await page.fill('[data-testid="settings-brand-primary"] input', '#2E5AAC');
    await expect(page.locator('[data-testid="settings-brand-palette"]')).toBeVisible();

    await page.click('[data-testid="settings-brand-save"]');
    await expect(page.locator('[data-testid="settings-brand-notice"]')).toContainText('saved');

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="settings-brand-primary"] input')).toHaveValue(
      '#2E5AAC',
    );
  } finally {
    if (originalColors) await patchSettings(baseURL!, { baseColors: originalColors });
  }
});

test('settings-brand: a colour the generator refuses is refused, not stored', async ({
  page,
  baseURL,
}) => {
  const before = await readSettings(baseURL!);
  const originalColors = before['brand']?.['baseColors'] as Record<string, unknown> | undefined;

  try {
    await openSettings(page, '/settings/brand', 'settings-brand-page');

    // Near-white cannot carry white text and cannot be moved, because it is
    // the operator's own colour.
    await page.fill('[data-testid="settings-brand-primary"] input', '#FFFFF0');

    await expect(page.locator('[data-testid="settings-brand-palette-error"]')).toBeVisible();
    // `data-testid` on `<app-button>` lands on the wrapper, not the native
    // `disabled` control the component renders internally — target that.
    await expect(page.locator('[data-testid="settings-brand-save"] button')).toBeDisabled();

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="settings-brand-primary"] input')).not.toHaveValue(
      '#FFFFF0',
    );
  } finally {
    if (originalColors) await patchSettings(baseURL!, { baseColors: originalColors });
  }
});

test('settings-money: the format saves, the sample follows it, and it restores', async ({
  page,
  baseURL,
}) => {
  const before = await readSettings(baseURL!);
  const original = before['money'] as Record<string, unknown>;

  try {
    await openSettings(page, '/settings/money', 'settings-money-page');

    const sample = page.locator('[data-testid="settings-money-sample-value"]');
    await expect(sample).not.toBeEmpty();
    const initial = (await sample.textContent())?.trim();

    await page.selectOption('[data-testid="settings-money-symbol-position"]', 'before');
    await expect(sample).not.toHaveText(initial ?? '');

    await page.click('[data-testid="settings-money-save"]');
    await expect(page.locator('[data-testid="settings-money-notice"]')).toContainText('saved');

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="settings-money-symbol-position"]')).toHaveValue(
      'before',
    );
  } finally {
    await patchSettings(baseURL!, {
      symbolPosition: original['symbolPosition'],
      decimalSeparator: original['decimalSeparator'],
      thousandsSeparator: original['thousandsSeparator'],
      taxDisplay: original['taxDisplay'],
      vatRate: original['vatRate'],
    });
  }
});

test('settings-domains: an origin saves and the empty rule is on the screen', async ({
  page,
  baseURL,
}) => {
  const before = await readSettings(baseURL!);
  const original = (before['domains']?.['admin'] as string) ?? '';

  try {
    await openSettings(page, '/settings/domains', 'settings-domains-page');

    // The rule an operator has to know before they touch a field.
    await expect(page.locator('[data-testid="settings-domains-empty-rule"]')).toContainText(
      'environment variable',
    );

    await page.fill('[data-testid="settings-domain-admin"] input', 'https://admin.example.test');
    await page.click('[data-testid="settings-domains-save"]');
    await expect(page.locator('[data-testid="settings-domains-notice"]')).toContainText('saved');

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="settings-domain-admin"] input')).toHaveValue(
      'https://admin.example.test',
    );
  } finally {
    await patchSettings(baseURL!, { admin: original });
  }
});

test('settings-domains: an origin with a path is refused before it is sent', async ({ page }) => {
  await openSettings(page, '/settings/domains', 'settings-domains-page');

  await page.fill('[data-testid="settings-domain-api"] input', 'https://api.example.test/v1');
  await page.locator('[data-testid="settings-domain-api"] input').blur();

  await expect(page.locator('[data-testid="settings-domains-page"]')).toContainText('no path');
});

test('settings-locales: the registry direction shows and is stored on save', async ({
  page,
  baseURL,
}) => {
  const before = await readSettings(baseURL!);
  const localization = before['localization'] ?? {};
  const originalSupported = (localization['supportedLocales'] as string[]) ?? [];
  const originalDefault = localization['defaultLocale'] as string;
  const originalRtl = (localization['rtlLocales'] as string[]) ?? [];

  try {
    await openSettings(page, '/settings/locales', 'settings-locales-page');

    if (!originalSupported.includes('ar')) {
      await page.check('[data-testid="settings-locale-ar"]');
    }
    await expect(page.locator('[data-testid="settings-direction-ar"]')).toHaveText('Right to left');
    await expect(page.locator('[data-testid^="settings-rtl-"]')).toHaveCount(0);

    if (!originalSupported.includes('ar')) {
      await page.click('[data-testid="settings-locales-save"]');
      await expect(page.locator('[data-testid="settings-locales-notice"]')).toContainText('saved');
    }

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="settings-direction-ar"]')).toHaveText('Right to left');
    const stored = (await readSettings(baseURL!))['localization']?.['rtlLocales'] as string[];
    expect(stored).toContain('ar');

    if (!originalSupported.includes('ar')) {
      // Turning a right-to-left locale off has to clear its direction in the
      // same request, or the API refuses the stored set as not a subset.
      await page.uncheck('[data-testid="settings-locale-ar"]');
      await page.click('[data-testid="settings-locales-save"]');
      await expect(page.locator('[data-testid="settings-locales-notice"]')).toContainText('saved');
      const after = (await readSettings(baseURL!))['localization'] ?? {};
      expect(after['supportedLocales']).not.toContain('ar');
      expect(after['rtlLocales']).not.toContain('ar');
    }
  } finally {
    await patchSettings(baseURL!, {
      supportedLocales: originalSupported,
      defaultLocale: originalDefault,
      rtlLocales: originalRtl,
    });
  }
});

// hardening-waived: describeEveryLocale - the admin chrome is not localized, and
// the locale is the shared superadmin's /me setting; mutating it races
// locale-persistence.
test('settings: no license screen or tile remains (DR-35)', async ({ page }) => {
  await openSettings(page, '/settings', 'settings-cards');
  await expect(page.locator('[data-testid="settings-card-domains"]')).toBeVisible();
  await expect(page.locator('[data-testid="settings-card-license"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="settings-card-disabled-license"]')).toHaveCount(0);

  await page.goto('/settings/license', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: /Page not found/i })).toBeVisible();

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: /Page not found/i })).toBeVisible();
  await expect(page.locator('[data-testid="settings-license-page"]')).toHaveCount(0);
});

test('settings-general: a Translatable legal name saves per locale and restores', async ({
  page,
  baseURL,
}) => {
  const before = await readSettings(baseURL!);
  const original = before['business']?.['legalName'];

  try {
    await openSettings(page, '/settings/general', 'settings-general-page');

    // The default tab, whichever locale the store leads with.
    // The test id lands on the `app-input` host, so the native control is one
    // level in. Filling the host silently does nothing.
    const field = page.locator('[data-testid="settings-legal-name-field"] input');
    await expect(field).toBeVisible();
    await field.fill('Demo Store SARL');

    await page.click('[data-testid="settings-general-save"]');
    await expect(page.locator('[data-testid="settings-general-notice"]')).toBeVisible();

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="settings-legal-name-field"] input')).toHaveValue(
      'Demo Store SARL',
    );
  } finally {
    if (original !== undefined) await patchSettings(baseURL!, { legalName: original });
  }
});

for (const screen of [
  { path: '/settings/brand', testId: 'settings-brand-page', name: 'brand' },
  { path: '/settings/money', testId: 'settings-money-page', name: 'money' },
  { path: '/settings/domains', testId: 'settings-domains-page', name: 'domains' },
  { path: '/settings/locales', testId: 'settings-locales-page', name: 'locales' },
  // The general screen is in this gate too: it gained the identity and legal
  // entity fieldsets, three Translatable editors among them, and it had never
  // had an axe or viewport pass of its own.
  { path: '/settings/general', testId: 'settings-general-page', name: 'general' },
] as const) {
  for (const viewport of VIEWPORTS) {
    test(`settings-${screen.name}: usable and axe-clean at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openSettings(page, screen.path, screen.testId);

      // No horizontal scroll: a settings grid that overflows a 360 px phone
      // hides its own controls off the inline edge.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(
        overflow,
        `${screen.path} scrolls horizontally at ${viewport.name}`,
      ).toBeLessThanOrEqual(1);

      await injectAxe(page);
      await checkA11y(page, undefined, { detailedReport: false });
    });
  }
}
