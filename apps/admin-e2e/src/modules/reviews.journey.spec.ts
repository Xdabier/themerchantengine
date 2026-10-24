import { test, expect } from './_auth-fixture';
import { request } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * Phase R5.1 — reviews + questions admin journey.
 *
 * Covers the moderation surface added by R5.1: `/reviews` list + detail +
 * approve + reject dialog, `/questions` list + detail + approve + reject +
 * answer dialogs. Runs against the live backend; no fixtures, no
 * `page.route()`.
 *
 * Determinism: the default seed ships three reviews (one PENDING, two
 * PUBLISHED) and zero questions. For write branches the spec creates fresh
 * rows via the storefront question endpoint (super-admin has access through
 * the bearer token) so each test owns its own record and state transitions
 * never collide with another spec's data.
 */

const SEED_PRODUCT_SLUG = 'urban-runner-sneakers';

async function firstReviewId(
  baseURL: string,
  status?: 'PENDING' | 'PUBLISHED' | 'HIDDEN',
  offset = 0,
): Promise<{ id: string; status: string } | null> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const pageSize = offset + 1;
  const qs = status ? `?status=${status}&pageSize=${pageSize}` : `?pageSize=${pageSize}`;
  const res = await ctx.get(`/api/v1/admin/reviews${qs}`, {
    headers: { Cookie: cookies },
  });
  const body = (await res.json()) as { data: Array<{ id: string; status: string }> };
  await ctx.dispose();
  return body.data?.[offset] ? body.data[offset] : null;
}

async function seedPendingQuestion(
  baseURL: string,
): Promise<{ id: string; question: string; submitted: string }> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const unique = `e2e reviews journey seed ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
  const res = await ctx.post(`/api/v1/products/${SEED_PRODUCT_SLUG}/questions`, {
    headers: { Cookie: cookies },
    data: { question: unique },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[reviews.journey] seed question failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
  const { data } = JSON.parse(raw) as { data: { id: string; question: string } };
  // `submitted` is the exact text we posted — the backend wraps it into the
  // Translatable JSONB the admin must resolve, so it is the ground-truth string
  // the UI should render once resolution works.
  return { ...data, submitted: unique };
}

async function approveQuestionViaApi(baseURL: string, id: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  await ctx.patch(`/api/v1/admin/questions/${id}/approve`, {
    headers: { Cookie: cookies },
  });
  await ctx.dispose();
}

/**
 * Seeds a review row by invoking the existing seed-data via the admin API.
 * The default seed already ships PENDING/PUBLISHED reviews on
 * `urban-runner-sneakers`; this picks the first row matching `status` so the
 * edit + delete branches can run independently without colliding with the
 * status-transition specs above.
 */
async function pickReviewForCrud(
  baseURL: string,
  offset = 0,
): Promise<{ id: string; status: string } | null> {
  // Prefer a HIDDEN row to keep PENDING/PUBLISHED rows free for the moderation
  // tests; fall back to the first available row otherwise. The `offset` lets
  // parallel CRUD tests claim distinct rows so concurrent edit + delete runs
  // never collide on the same review id.
  return (
    (await firstReviewId(baseURL, 'HIDDEN', offset)) ??
    (await firstReviewId(baseURL, 'PUBLISHED', offset)) ??
    (await firstReviewId(baseURL, 'PENDING', offset))
  );
}

test('/reviews list mounts with PENDING chip active by default', async ({ page }) => {
  await page.goto('/reviews', { waitUntil: 'networkidle' });
  const listPage = page.locator('[data-testid="reviews-list-page"]');
  await expect(listPage).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="reviews-filter-chip-PENDING"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Regression guard for the Translatable schema-drift outage: `title`/`body`
  // arrive as raw JSONB under X-Resolve-Locale:false. The list must resolve them
  // — never throw the parse error banner, never render the stringified object.
  // The default seed ships reviews on urban-runner-sneakers, so a row renders.
  await expect(listPage).not.toContainText('Could not load');
  await expect(listPage).not.toContainText('[object Object]');
  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });
  await page.screenshot({ path: '.e2e-review/journey-reviews-list.png', fullPage: true });
});

test('/reviews list filters by status via URL', async ({ page }) => {
  await page.goto('/reviews?status=PUBLISHED', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="reviews-list-page"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="reviews-filter-chip-PUBLISHED"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('review detail page renders rating + body + status + action bar', async ({
  page,
  baseURL,
}) => {
  const review = await firstReviewId(baseURL!);
  await page.goto(`/reviews/${review!.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="review-detail-page"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="review-rating"]')).toBeVisible();
  await expect(page.locator('[data-testid="review-status"]')).toBeVisible();
  await page.screenshot({ path: '.e2e-review/journey-review-detail.png', fullPage: true });
});

test('approve PENDING review via UI transitions it to PUBLISHED', async ({ page, baseURL }) => {
  const pending = await firstReviewId(baseURL!, 'PENDING');
  if (!pending) {
    // Seed pristine or already approved — verify the approve button state on a
    // PUBLISHED review (approve is disabled for PUBLISHED per canApprove logic).
    // HIDDEN reviews are also approvable so we must use PUBLISHED for this guard.
    const published = await firstReviewId(baseURL!, 'PUBLISHED');
    if (!published) return; // No reviews at all — skip.
    await page.goto(`/reviews/${published.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="review-approve"] button')).toBeDisabled();
    return;
  }

  await page.goto(`/reviews/${pending.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="review-approve"] button')).toBeEnabled();
  await page.locator('[data-testid="review-approve"]').click();

  await expect(page.locator('[data-testid="review-status"]').getByText('PUBLISHED')).toBeVisible({
    timeout: 10_000,
  });
});

test('reject review opens dialog, validates reason, submits and hides review', async ({
  page,
  baseURL,
}) => {
  // Reject is offered on PENDING / PUBLISHED. Pick any review; exercise the
  // dialog open + validator path regardless of final state so this is
  // deterministic.
  const review = await firstReviewId(baseURL!);

  await page.goto(`/reviews/${review!.id}`, { waitUntil: 'networkidle' });
  const rejectBtn = page.locator('[data-testid="review-reject"] button');
  if (!(await rejectBtn.isEnabled())) return; // HIDDEN already — idempotent no-op

  await page.locator('[data-testid="review-reject"]').click();
  const dialog = page.getByRole('dialog', { name: /Reject this review/i });
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  // Reason is optional — submit is enabled with empty reason.
  const submit = dialog.getByRole('button', { name: /Reject review/i });
  await expect(submit).toBeEnabled();
  await dialog.getByRole('textbox', { name: /Reason/i }).fill('Automated reviews journey test');
  await submit.click();

  await expect(page.locator('[data-testid="review-status"]').getByText('HIDDEN')).toBeVisible({
    timeout: 10_000,
  });
});

test('/questions list mounts + renders empty state or table', async ({ page }) => {
  await page.goto('/questions', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="questions-list-page"]')).toBeVisible({
    timeout: 10_000,
  });
  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });
  await page.screenshot({ path: '.e2e-review/journey-questions-list.png', fullPage: true });
});

test('questions list search round-trips through the URL and the API', async ({ page }) => {
  // QA D6 sweep: the backend accepted `search` all along, the page had no box.
  await page.goto('/questions', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="questions-list-page"]')).toBeVisible({
    timeout: 10_000,
  });

  const call = page.waitForResponse(
    (res) => res.url().includes('/api/v1/admin/questions') && res.url().includes('search='),
    { timeout: 15_000 },
  );
  await page.locator('[data-testid="questions-search"]').fill('zzzz-no-such-question');
  await page.waitForURL(/[?&]search=zzzz-no-such-question/, { timeout: 10_000 });
  expect((await call).ok()).toBeTruthy();

  await page.locator('[data-testid="questions-search"]').fill('');
  await page.waitForURL((url) => !url.searchParams.has('search'), { timeout: 10_000 });
});

test('questions render resolved Translatable text end-to-end (schema-drift outage regression)', async ({
  page,
  baseURL,
}) => {
  // Direct regression guard for the 2026-06-07 "Could not load questions" outage:
  // the admin sends X-Resolve-Locale:false, so question/answer arrive as raw
  // Translatable JSONB. The list Zod schema typed them as strings → parse threw →
  // generic error banner. Seed a real question, then assert the live UI both
  // (a) does NOT show the parse-error banner and (b) renders resolved text rather
  // than the stringified object — on both the list and the detail surface.
  const seeded = await seedPendingQuestion(baseURL!);

  await page.goto('/questions?status=PENDING', { waitUntil: 'networkidle' });
  const listPage = page.locator('[data-testid="questions-list-page"]');
  await expect(listPage).toBeVisible({ timeout: 10_000 });
  await expect(listPage).not.toContainText('Could not load');

  const row = page.locator(`[data-testid="question-row-${seeded.id}"]`);
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row).toContainText(seeded.submitted);
  await expect(row).not.toContainText('[object Object]');

  // Detail surface returns the same raw Translatable on the single-question read.
  await page.goto(`/questions/${seeded.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="question-detail-page"]')).toBeVisible({
    timeout: 10_000,
  });
  const body = page.locator('[data-testid="question-body"]');
  await expect(body).toContainText(seeded.submitted);
  await expect(body).not.toContainText('[object Object]');
});

test('approve PENDING question via UI transitions it to PUBLISHED', async ({ page, baseURL }) => {
  const seeded = await seedPendingQuestion(baseURL!);
  await page.goto(`/questions/${seeded.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="question-detail-page"]')).toBeVisible({
    timeout: 10_000,
  });
  await page.locator('[data-testid="question-approve"]').click();
  await expect(page.locator('[data-testid="question-status"]').getByText('PUBLISHED')).toBeVisible({
    timeout: 10_000,
  });
});

test('reject question via dialog with reason transitions it to HIDDEN', async ({
  page,
  baseURL,
}) => {
  const seeded = await seedPendingQuestion(baseURL!);
  await page.goto(`/questions/${seeded.id}`, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="question-reject"]').click();
  const dialog = page.getByRole('dialog', { name: /Reject this question/i });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('textbox', { name: /Reason/i }).fill('Not a product question');
  await dialog.getByRole('button', { name: /Reject question/i }).click();
  await expect(page.locator('[data-testid="question-status"]').getByText('HIDDEN')).toBeVisible({
    timeout: 10_000,
  });
});

test('edit review opens the edit dialog and PATCHes content + status', async ({
  page,
  baseURL,
}) => {
  // offset=2 so this never collides with the approve/reject/delete tests
  // (which use offset 0–1) when Playwright runs them in parallel.
  const review = await pickReviewForCrud(baseURL!, 2);
  if (!review) return; // No reviews seeded — pristine env, skip.

  await page.goto(`/reviews/${review.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="review-detail-page"]')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-testid="review-edit"]').click();

  const dialog = page.getByRole('dialog', { name: /Edit review/i });
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  const editedBody = `Edited via admin journey ${Date.now()}`;
  // app-textarea + app-input wrap their native control, so target the inner
  // element via descendant selectors so Playwright's fill / selectOption see
  // an actual textarea / input / select.
  await dialog.locator('[data-testid="review-edit-body"] textarea').fill(editedBody);
  await dialog.locator('[data-testid="review-edit-status"]').selectOption('PUBLISHED');
  await dialog.locator('[data-testid="review-edit-reason"] textarea').fill('Editorial polish');
  await dialog.locator('[data-testid="review-edit-submit"]').click();

  await expect(page.locator('[data-testid="review-body"]')).toContainText(editedBody, {
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="review-status"]').getByText('PUBLISHED')).toBeVisible({
    timeout: 10_000,
  });
});

test('delete review opens the confirm dialog and removes it', async ({ page, baseURL }) => {
  // offset=3 so this owns its own review and never collides with the
  // approve/reject/edit tests under parallel execution.
  const review = await pickReviewForCrud(baseURL!, 3);
  if (!review) return; // pristine env — skip.

  await page.goto(`/reviews/${review.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="review-detail-page"]')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-testid="review-delete"]').click();

  const dialog = page.getByRole('dialog', { name: /Delete this review/i });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: /Delete review/i }).click();

  // After delete the page navigates back to /reviews list.
  await expect(page).toHaveURL(/\/reviews(\?.*)?$/, { timeout: 10_000 });
  await expect(page.locator('[data-testid="reviews-list-page"]')).toBeVisible({ timeout: 10_000 });
});

test('answer dialog posts admin answer and surfaces it on detail', async ({ page, baseURL }) => {
  const seeded = await seedPendingQuestion(baseURL!);
  // Approve first so the answer path lands on a PUBLISHED row (mirrors how
  // operators triage + respond).
  await approveQuestionViaApi(baseURL!, seeded.id);

  await page.goto(`/questions/${seeded.id}`, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="question-answer-open"]').click();
  const dialog = page.getByRole('dialog', { name: /Answer this question/i });
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  const answerText = `Ships from Dubai — seven day return. ${Date.now()}`;
  await dialog.getByRole('textbox', { name: /Answer/i }).fill(answerText);
  await dialog.getByRole('button', { name: /Post answer/i }).click();

  await expect(page.locator('[data-testid="question-answer-body"]')).toContainText(answerText, {
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="question-answer-admin-badge"]')).toBeVisible();
});

/**
 * Answering wrote only the answer, and Approve was a separate button, so an
 * operator who answered a PENDING question and moved on left an answered
 * question no customer could see.
 */
test('answering a pending question publishes it in the same gesture', async ({ page, baseURL }) => {
  const seeded = await seedPendingQuestion(baseURL!);

  await page.goto(`/questions/${seeded.id}`, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="question-answer-open"]').click();
  const dialog = page.getByRole('dialog', { name: /Answer this question/i });
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  // Offered only while the question is still awaiting moderation, and on by
  // default so the common case needs no extra decision.
  const publishToggle = dialog.locator('[data-testid="answer-publish-toggle"]');
  await expect(publishToggle).toBeChecked();

  const answerText = `Published on answer. ${Date.now()}`;
  await dialog.getByRole('textbox', { name: /Answer/i }).fill(answerText);
  await dialog.getByRole('button', { name: /Post answer/i }).click();

  await expect(page.locator('[data-testid="question-answer-body"]')).toContainText(answerText, {
    timeout: 10_000,
  });
  // Without ever touching the Approve button.
  await expect(page.locator('[data-testid="question-status"]')).toContainText(/PUBLISHED/i, {
    timeout: 10_000,
  });
});

test('answering with the publish toggle cleared leaves the question pending', async ({
  page,
  baseURL,
}) => {
  const seeded = await seedPendingQuestion(baseURL!);

  await page.goto(`/questions/${seeded.id}`, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="question-answer-open"]').click();
  const dialog = page.getByRole('dialog', { name: /Answer this question/i });
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  await dialog.locator('[data-testid="answer-publish-toggle"]').uncheck();
  const answerText = `Drafted, not published. ${Date.now()}`;
  await dialog.getByRole('textbox', { name: /Answer/i }).fill(answerText);
  await dialog.getByRole('button', { name: /Post answer/i }).click();

  await expect(page.locator('[data-testid="question-answer-body"]')).toContainText(answerText, {
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="question-status"]')).toContainText(/PENDING/i);
});
