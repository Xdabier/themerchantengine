import { test, expect } from './_auth-fixture';
import { request, type APIRequestContext } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * The store's own name and mark in the admin shell (plan E3.2).
 *
 * Every write here goes through the real API, so the suite exercises the same
 * settings surface an operator uses. The logo half has to plant its own value:
 * `brand.logoAssetId` is null in all three scenario fixtures and no seed path
 * writes `appearance.logoUrl`, so a journey that only read what the seed
 * produced would assert on the no-logo branch and call that coverage.
 */

/*
 * Serial, because two tests here rename the store and put it back, and the
 * store name is a singleton every other test in this file reads. Run in
 * parallel, the read below saw the rename mid-flight and asserted the wrong
 * name. Serial fixes this file; across files the same window is why the
 * renames restore in a `finally` and why CI runs this suite on one worker.
 */
test.describe.configure({ mode: 'serial' });

const IDENTITY = '[data-testid="topbar-store-identity"]';
const STORE_NAME = '[data-testid="topbar-store-name"]';
const STORE_LOGO = '[data-testid="topbar-store-logo"]';

/**
 * A site-relative path rather than a `data:` URI or an upload. The settings
 * DTO accepts an empty value, an absolute http(s) URL or a site-relative path
 * and nothing else, and an upload would be testing the asset pipeline rather
 * than what the shell does with a configured URL.
 */
const LOGO_PATH = '/e2e-shell-identity-logo.png';

/**
 * The identity block is desktop chrome, and it waits for `lg` rather than
 * `md`: the header has no room for it between 768 and 1024 alongside the
 * controls an operator cannot do without. The two projects that run this spec
 * sit either side of that, so the threshold is what the topbar actually uses
 * rather than the 768 this once assumed.
 */
function isDesktop(page: { viewportSize(): { width: number } | null }): boolean {
  return (page.viewportSize()?.width ?? 0) >= 1024;
}

/** The settings API resolves Translatables unless a caller opts out. */
function resolveName(value: unknown, locale: string): string {
  if (typeof value === 'string') return value;
  const map = (value ?? {}) as Record<string, string>;
  return map[locale] ?? map['en'] ?? map['default'] ?? '';
}

let api: APIRequestContext;
let original: Record<string, unknown>;

test.beforeAll(async ({ baseURL }) => {
  api = await request.newContext({
    baseURL,
    // Without this, TranslatableInterceptor resolves `storeName` to a plain
    // string for this locale, and restoring that string later fails the PATCH
    // DTO's `@IsObject()` check. That failure used to be silent, and the
    // rename outlived the test: it leaked into the topbar of every later
    // screenshot and failed four desktop visual-regression projects a long
    // way from the spec that caused it. `restore` below is what makes such a
    // failure loud from now on.
    extraHTTPHeaders: {
      Cookie: getAdminCookies(baseURL as string),
      'X-Resolve-Locale': 'false',
    },
  });
  const res = await api.get('/api/v1/admin/settings');
  expect(res.ok(), 'could not read the settings this journey restores afterwards').toBe(true);
  const body = (await res.json()) as { data: Record<string, Record<string, unknown>> };
  original = {
    storeName: body.data['general']?.['storeName'],
    // Not a live read: the settings journey sets a logo for a moment in a
    // parallel worker, and capturing it here wrote it back for good in the
    // afterAll. No seed writes a logo, so empty is the value to put back.
    logoUrl: '',
    defaultLocale: body.data['localization']?.['defaultLocale'],
  };
});

/**
 * Put a settings singleton back, and fail loudly when that does not work.
 *
 * A restore that quietly 400s is worse than no restore at all: the store keeps
 * a test's value, every later screenshot renders it, and the failures land in
 * specs that never touched settings.
 */
async function restore(data: Record<string, unknown>): Promise<void> {
  const res = await api.patch('/api/v1/admin/settings', { data });
  if (!res.ok()) {
    throw new Error(
      `[shell-identity] restoring ${Object.keys(data).join(', ')} failed: ` +
        `${res.status()} ${await res.text()}`,
    );
  }
}

test.afterAll(async () => {
  // Other specs read these rows. Leaving a test name behind would move a
  // baseline nobody edited.
  await restore({ storeName: original['storeName'], logoUrl: original['logoUrl'] });
  await api.dispose();
});

test('the shell and the document title carry the store name', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="app-shell-main"]')).toBeVisible({ timeout: 15_000 });

  // The value captured before any test ran, not a live read: a live read can
  // catch the rename below mid-flight and assert a name that is on its way out.
  const expected = resolveName(original['storeName'], original['defaultLocale'] as string);

  expect(expected, 'the seeded store has no name, so this journey proves nothing').toBeTruthy();
  // The raw Translatable, not a resolved string: the restore depends on the
  // shape this context asked for, so the spec asserts it got that shape.
  expect(
    typeof original['storeName'],
    'the settings read resolved the Translatable, so every restore here would 400',
  ).toBe('object');
  // The title is the same at every width; the identity block is not.
  await expect(page).toHaveTitle(new RegExp(escapeRegExp(expected)));
  if (isDesktop(page)) {
    await expect(page.locator(STORE_NAME)).toContainText(expected);
  } else {
    await expect(
      page.locator(IDENTITY),
      'the identity block is `hidden lg:flex`, so a narrow topbar must not render it',
    ).toBeHidden();
  }
});

test('a renamed store reaches the shell and the title after a reload', async ({ page }) => {
  // Desktop only, and not because of the viewport: this renames a singleton
  // in a database both Playwright projects share. Run in both, the two copies
  // rename the store milliseconds apart and each asserts on the other's name.
  // The title is viewport-independent, so running it once proves it once.
  test.skip(!isDesktop(page), 'renames a shared singleton; it must run once');
  const renamed = `Shell Identity ${Date.now()}`;
  await page.goto('/settings', { waitUntil: 'networkidle' });

  // The store name is a singleton every other spec can see, and it renders on
  // the general settings screen that the visual baselines pin. The restore is
  // a `finally` rather than an `afterAll` so the window is this test rather
  // than this file, and `restore` throws when it does not take.
  try {
    const res = await api.patch('/api/v1/admin/settings', {
      data: { storeName: { default: renamed } },
    });
    expect(res.ok(), await res.text()).toBe(true);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page).toHaveTitle(new RegExp(escapeRegExp(renamed)), { timeout: 15_000 });
    if (isDesktop(page)) {
      await expect(page.locator(STORE_NAME)).toContainText(renamed, { timeout: 15_000 });
    }
  } finally {
    await restore({ storeName: original['storeName'] });
  }
});

test('a configured logo renders beside the name, and is not announced twice', async ({ page }) => {
  test.skip(!isDesktop(page), 'the identity block, and so its mark, is desktop chrome');
  try {
    const res = await api.patch('/api/v1/admin/settings', { data: { logoUrl: LOGO_PATH } });
    expect(res.ok(), await res.text()).toBe(true);

    await page.goto('/settings', { waitUntil: 'networkidle' });
    const logo = page.locator(STORE_LOGO);
    // Count, not visibility: nothing serves this path, and a broken image
    // whose alt is empty collapses to a zero-size box. What the shell owes is
    // the element and its attributes; whether a URL an operator typed
    // resolves is not the admin's contract.
    await expect(logo).toHaveCount(1, { timeout: 15_000 });
    await expect(logo).toHaveAttribute('src', LOGO_PATH);
    // The name sits right beside it, so the mark is decorative. An announced
    // alt here would read the store's name out twice.
    await expect(logo).toHaveAttribute('alt', '');
    await expect(logo).toHaveAttribute('aria-hidden', 'true');
  } finally {
    await restore({ logoUrl: original['logoUrl'] });
  }
});

test('no logo renders when the store has not configured one', async ({ page }) => {
  test.skip(!isDesktop(page), 'the identity block, and so its mark, is desktop chrome');
  // The branch every seeded install actually takes: `brand.logoAssetId` is
  // null in all three fixtures and no seed writes `appearance.logoUrl`.
  await page.goto('/settings', { waitUntil: 'networkidle' });
  await expect(page.locator(STORE_NAME)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(STORE_LOGO)).toHaveCount(0);
});

test('the shell chrome is axe-clean in both colour modes', async ({ page }) => {
  // The toggle and the identity both live in chrome that no journey audited
  // before this one, so a violation in either had nothing to fail.
  await page.goto('/settings', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="app-topbar"]')).toBeVisible({ timeout: 15_000 });

  for (const mode of ['dark', 'light'] as const) {
    await page.evaluate((theme) => {
      document.documentElement.setAttribute('data-theme', theme);
    }, mode);
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: false });
  }
});

test('the theme toggle commits a mode and it survives a reload', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' });
  const toggle = page.locator('[data-testid="topbar-theme-toggle"]');
  await expect(toggle).toBeVisible({ timeout: 15_000 });

  // The harness pins the dark colour scheme, so this starts dark.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-label', 'Switch to light mode');

  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(toggle).toHaveAttribute('aria-label', 'Switch to dark mode');

  // The preference has to outlive the tab, and it has to be applied before
  // the first paint rather than when Angular boots.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('an operator can sign out at every width, phones included', async ({ page }) => {
  // This spec is one of the four the `authed-mobile` project matches, so it
  // runs at 390 px as well as at 1440. A topbar change once hid the account
  // menu and sign-out below `md` to cure an overflow, which left an operator
  // on a phone with no way to end their session: the mobile drawer carries
  // navigation only, and nothing else in the shell offers it.
  await page.goto('/settings', { waitUntil: 'networkidle' });

  const signOut = page.locator('[data-testid="topbar-logout"]');
  await expect(signOut, 'sign out is unreachable at this width').toBeVisible({ timeout: 15_000 });
  await expect(signOut).toBeEnabled();

  const box = await signOut.boundingBox();
  expect(box, 'sign out has no box, so it is not laid out').not.toBeNull();
  const viewport = page.viewportSize();
  // Inside the viewport, not merely present in the DOM: a control pushed past
  // the inline edge by an overflowing header is as unreachable as a hidden one.
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
});
