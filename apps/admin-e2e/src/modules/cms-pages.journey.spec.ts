import { test, expect } from './_auth-fixture';
import { request } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';
import {
  ADMIN_LOCALES,
  describeEveryLocale,
  localizedValue,
  translatableForEveryLocale,
} from '../support/locale-matrix';

/**
 * R5.3 — CMS Pages admin journey.
 *
 * Covers `/pages` (list + seeded row + delete), `/pages/new` (create +
 * slug validator + 409 conflict mapping), and `/pages/:id/edit` (edit
 * title + slug-disabled-on-edit). Live backend. No `page.route()`, no
 * fixtures.
 *
 * Determinism: every write test seeds its own `/e2e-cms-<timestamp>`
 * slug via the admin API so concurrent browsers never collide.
 */

function uniqueSlug(label: string): string {
  return `/e2e-cms-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function seedPage(
  baseURL: string,
  slug: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; slug: string }> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/v1/admin/pages', {
    headers: { Cookie: cookies },
    data: {
      slug,
      type: 'STATIC',
      title: { default: 'E2E seed' },
      content: { default: '<p>seed body</p>' },
      isPublished: false,
      ...overrides,
    },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[cms-pages.journey] seed page failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
  const { data } = JSON.parse(raw) as { data: { id: string; slug: string } };
  return data;
}

async function deletePageViaApi(baseURL: string, id: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  await ctx.delete(`/api/v1/admin/pages/${id}`, {
    headers: { Cookie: cookies },
  });
  await ctx.dispose();
}

test('/pages mounts, is a11y-clean, and shows seeded row', async ({ page, baseURL }) => {
  const seed = await seedPage(baseURL!, uniqueSlug('list'));
  try {
    await page.goto('/pages', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="cms-pages-list-page"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator(`[data-testid="cms-page-row-${seed.id}"]`)).toBeVisible();
    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });
  } finally {
    await deletePageViaApi(baseURL!, seed.id);
  }
});

test('/pages/new rejects slugs without a leading /', async ({ page }) => {
  await page.goto('/pages/new', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="cms-page-editor-page"]')).toBeVisible({
    timeout: 10_000,
  });

  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });

  const slugField = page.locator('[data-testid="cms-page-slug"]').locator('input');
  await slugField.fill('no-slash');
  await slugField.blur();
  await expect(page.getByText(/must start with \//i).first()).toBeVisible();

  const submit = page.locator('[data-testid="cms-page-submit"]').locator('button');
  await expect(submit).toBeDisabled();
});

test('/pages/new persists a STATIC page and redirects to the list', async ({ page, baseURL }) => {
  const slug = uniqueSlug('create');
  await page.goto('/pages/new', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="cms-page-editor-page"]')).toBeVisible({
    timeout: 10_000,
  });

  await page.locator('[data-testid="cms-page-slug"]').locator('input').fill(slug);
  await page.locator('[data-testid="cms-page-title"]').locator('input').fill('E2E created page');
  await page
    .locator('[data-testid="cms-page-content-editor-editable"]')
    .fill('Body content for the e2e test.');

  await page.locator('[data-testid="cms-page-submit"]').locator('button').click();
  await page.waitForURL(/\/pages($|\?)/);
  await expect(page.locator('[data-testid="cms-pages-list-page"]')).toBeVisible({
    timeout: 10_000,
  });

  // Cleanup via API — find the id through the list endpoint.
  const cookies = getAdminCookies(baseURL!);
  const ctx = await request.newContext({ baseURL });
  const listRes = await ctx.get('/api/v1/admin/pages?pageSize=100', {
    headers: { Cookie: cookies },
  });
  const { data } = (await listRes.json()) as { data: Array<{ id: string; slug: string }> };
  await ctx.dispose();
  const row = data.find((r) => r.slug === slug);
  if (row) await deletePageViaApi(baseURL!, row.id);
});

test('/pages/new surfaces 409 as a field error on slug', async ({ page, baseURL }) => {
  const seed = await seedPage(baseURL!, uniqueSlug('dup'));
  try {
    await page.goto('/pages/new', { waitUntil: 'networkidle' });
    await page.locator('[data-testid="cms-page-slug"]').locator('input').fill(seed.slug);
    await page.locator('[data-testid="cms-page-title"]').locator('input').fill('Duplicate attempt');
    await page.locator('[data-testid="cms-page-content-editor-editable"]').fill('Duplicate body.');
    await page.locator('[data-testid="cms-page-submit"]').locator('button').click();
    await expect(page.getByText(/already exists/i)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/pages\/new/);
  } finally {
    await deletePageViaApi(baseURL!, seed.id);
  }
});

test('/pages/:id/edit updates the title and disables slug', async ({ page, baseURL }) => {
  const seed = await seedPage(baseURL!, uniqueSlug('edit'));
  try {
    await page.goto(`/pages/${seed.id}/edit`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="cms-page-editor-page"]')).toBeVisible({
      timeout: 10_000,
    });

    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });

    const slugInput = page.locator('[data-testid="cms-page-slug"]').locator('input');
    await expect(slugInput).toBeDisabled();

    const titleInput = page.locator('[data-testid="cms-page-title"]').locator('input');
    await titleInput.fill('E2E edited title');
    await page.locator('[data-testid="cms-page-submit"]').locator('button').click();

    await page.waitForURL(/\/pages($|\?)/);
    await expect(page.locator('[data-testid="cms-pages-list-page"]')).toBeVisible({
      timeout: 10_000,
    });

    const row = page.locator(`[data-testid="cms-page-row-${seed.id}"]`);
    await expect(row).toContainText('E2E edited title');
    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });
  } finally {
    await deletePageViaApi(baseURL!, seed.id);
  }
});

test('/pages delete removes the seeded row', async ({ page, baseURL }) => {
  const seed = await seedPage(baseURL!, uniqueSlug('del'));
  let cleanupNeeded = true;
  try {
    await page.goto('/pages', { waitUntil: 'networkidle' });
    const row = page.locator(`[data-testid="cms-page-row-${seed.id}"]`);
    await expect(row).toBeVisible({ timeout: 10_000 });

    await page.locator(`[data-testid="cms-page-delete-${seed.id}"]`).locator('button').click();
    const dialog = page.getByRole('dialog', { name: /Delete this page/i });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });
    await dialog.getByRole('button', { name: /^Delete$/i }).click();

    await expect(row).toHaveCount(0, { timeout: 10_000 });
    cleanupNeeded = false;
  } finally {
    if (cleanupNeeded) await deletePageViaApi(baseURL!, seed.id);
  }
});

/**
 * Plan D Phase D1 — the rich-text editor pane must show what the save stores.
 *
 * Two halves of the same complaint ("the editor loses my formatting"):
 * structure, where `formatBlock('H2')` with the caret in a list item wrapped
 * the whole list and shipped `<h2><ul>..</ul></h2>` to the storefront; and
 * appearance, where Tailwind preflight stripped the list markers and flattened
 * the headings inside the pane, so the merchant saw neither bullets nor a
 * heading scale while the stored value was already correct.
 */
async function fetchPageViaApi(baseURL: string, id: string): Promise<Record<string, unknown>> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  // The admin CMS controller has no read-by-id route; the editor screen picks
  // its row out of the list, so the spec reads it the same way.
  const res = await ctx.get('/api/v1/admin/pages?pageSize=100', {
    headers: { Cookie: cookies, 'X-Resolve-Locale': 'false' },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[cms-pages.journey] read page failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
  const rows = (JSON.parse(raw) as { data: Record<string, unknown>[] }).data;
  const row = rows.find((entry) => entry['id'] === id);
  if (!row) throw new Error(`[cms-pages.journey] page ${id} missing from the admin list`);
  return row;
}

test('the editor pane renders bullets and a heading scale', async ({ page, baseURL }) => {
  // Every locale, not just `default`: the editor opens on the first store
  // locale tab, so a default-only seed renders an empty pane.
  const body = '<p>Paragraphe.</p><ul><li>Point un</li></ul><h2>Titre</h2>';
  const seed = await seedPage(baseURL!, uniqueSlug('pane'), {
    content: { default: body, fr: body, en: body },
  });
  try {
    await page.goto(`/pages/${seed.id}/edit`, { waitUntil: 'networkidle' });
    const editable = page.locator('[data-testid="cms-page-content-editor-editable"]');
    await expect(editable).toBeVisible({ timeout: 10_000 });

    const marker = await editable
      .locator('ul')
      .evaluate((el) => getComputedStyle(el).listStyleType);
    expect(marker, 'a bulleted list must show its markers in the pane').not.toBe('none');

    const headingSize = await editable
      .locator('h2')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const bodySize = await editable
      .locator('p')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(headingSize, 'a heading must not render at body size').toBeGreaterThan(bodySize);
  } finally {
    await deletePageViaApi(baseURL!, seed.id);
  }
});

test('H2 on a list line leaves the list and lands the heading', async ({ page, baseURL }) => {
  const seed = await seedPage(baseURL!, uniqueSlug('nesting'), {
    content: { default: '<p>Seed</p>', fr: '<p>Seed</p>', en: '<p>Seed</p>' },
  });
  try {
    await page.goto(`/pages/${seed.id}/edit`, { waitUntil: 'networkidle' });
    const editable = page.locator('[data-testid="cms-page-content-editor-editable"]');
    await expect(editable).toBeVisible({ timeout: 10_000 });

    await editable.fill('Ligne un');
    await page.locator('[data-testid="cms-page-content-editor-ul"]').click();
    await expect(editable.locator('li')).toHaveText('Ligne un');
    await page.locator('[data-testid="cms-page-content-editor-h2"]').click();
    await editable.blur();

    // Chromium's formatBlock refuses to act while the caret is in a list item,
    // so the button was a silent no-op: the merchant clicked H2 and nothing
    // happened. Leaving the list first is what makes the heading land.
    await expect(editable.locator('h2')).toHaveText('Ligne un');
    await expect(editable.locator('li')).toHaveCount(0);

    await page.locator('[data-testid="cms-page-submit"]').click();
    await expect(page.locator('[data-testid="cms-page-top-error"]')).toHaveCount(0);

    await expect
      .poll(async () => JSON.stringify((await fetchPageViaApi(baseURL!, seed.id))['content']), {
        timeout: 10_000,
      })
      .toContain('Ligne un');

    const content = JSON.stringify((await fetchPageViaApi(baseURL!, seed.id))['content']);
    expect(content, 'the heading the merchant asked for must survive the save').toContain(
      '<h2>Ligne un</h2>',
    );
    expect(content, 'a heading must never wrap a list in the stored value').not.toMatch(
      /<h[1-4]>\s*<(?:ul|ol)/i,
    );
  } finally {
    await deletePageViaApi(baseURL!, seed.id);
  }
});

/**
 * Locale matrix: the title is a Translatable, so each enabled locale has its
 * own tab. Editing one tab must change that locale only, and the saved value
 * must survive a reload of the editor.
 */
describeEveryLocale('/pages/:id/edit translatable title', (locale) => {
  test(`edits the ${locale} title without touching the other locales`, async ({
    page,
    baseURL,
  }) => {
    const seed = await seedPage(baseURL!, uniqueSlug(`loc-${locale}`), {
      title: translatableForEveryLocale('Seed title'),
      content: translatableForEveryLocale('<p>Seed body</p>'),
    });
    try {
      await page.goto(`/pages/${seed.id}/edit`, { waitUntil: 'networkidle' });
      const title = page.locator('[data-testid="cms-page-title"]');
      await expect(title).toBeVisible({ timeout: 10_000 });

      await title.getByRole('tab', { name: new RegExp(`^${locale}`, 'i') }).click();
      const input = title.locator('input');
      await expect(input).toHaveValue(localizedValue('Seed title', locale));

      const edited = localizedValue('Edited title', locale);
      await input.fill(edited);
      await page.locator('[data-testid="cms-page-submit"]').locator('button').click();
      await page.waitForURL(/\/pages($|\?)/);

      const stored = (await fetchPageViaApi(baseURL!, seed.id))['title'] as Record<string, string>;
      expect(stored[locale]).toBe(edited);
      for (const other of ADMIN_LOCALES.filter((candidate) => candidate !== locale)) {
        expect(stored[other], `${other} title must be untouched`).toBe(
          localizedValue('Seed title', other),
        );
      }

      await page.goto(`/pages/${seed.id}/edit`, { waitUntil: 'networkidle' });
      await title.getByRole('tab', { name: new RegExp(`^${locale}`, 'i') }).click();
      await expect(title.locator('input')).toHaveValue(edited);
    } finally {
      await deletePageViaApi(baseURL!, seed.id);
    }
  });
});

/**
 * Locale matrix, error path: a duplicate slug is refused with a field error
 * whatever tab the editor has open, and the title typed in that tab survives
 * the refusal.
 */
describeEveryLocale('/pages/new duplicate slug error', (locale) => {
  test(`keeps the ${locale} title when the slug conflicts`, async ({ page, baseURL }) => {
    const seed = await seedPage(baseURL!, uniqueSlug(`dup-${locale}`));
    try {
      await page.goto('/pages/new', { waitUntil: 'networkidle' });
      await page.locator('[data-testid="cms-page-slug"]').locator('input').fill(seed.slug);

      const title = page.locator('[data-testid="cms-page-title"]');
      await title.getByRole('tab', { name: new RegExp(`^${locale}`, 'i') }).click();
      const typed = localizedValue('Duplicate attempt', locale);
      await title.locator('input').fill(typed);
      await page
        .locator('[data-testid="cms-page-content-editor-editable"]')
        .fill('Duplicate body.');
      await page.locator('[data-testid="cms-page-submit"]').locator('button').click();

      await expect(page.getByText(/already exists/i)).toBeVisible({ timeout: 10_000 });
      await expect(page).toHaveURL(/\/pages\/new/);
      await title.getByRole('tab', { name: new RegExp(`^${locale}`, 'i') }).click();
      await expect(title.locator('input')).toHaveValue(typed);
    } finally {
      await deletePageViaApi(baseURL!, seed.id);
    }
  });
});
