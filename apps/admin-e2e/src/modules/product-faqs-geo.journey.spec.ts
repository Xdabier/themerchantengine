import { test, expect } from './_auth-fixture';
import { request } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * R6.15 — Product FAQ CRUD + GEO AI-readiness journey.
 *
 * Five serial scenarios against the live backend — no page.route(), no
 * fixtures, no MSW. Each scenario seeds its own disposable product via
 * POST, exercises the flow, and soft-deletes the product in teardown
 * (soft-delete cascades FAQs).
 */

test.describe.configure({ mode: 'serial' });

function uniqueSlug(): string {
  return `e2e-faqgeo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function seedProduct(baseURL: string): Promise<{ id: string; slug: string }> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const slug = uniqueSlug();
  const res = await ctx.post('/api/v1/admin/products', {
    headers: { Cookie: cookies },
    data: {
      name: {
        default: `FAQ-GEO E2E ${slug}`,
        en: `FAQ-GEO E2E ${slug}`,
        fr: `FAQ-GEO E2E ${slug}`,
      },
      slug,
      status: 'DRAFT',
      description: {
        default:
          'Durable FAQ + GEO journey fixture description long enough to satisfy the answer-first signal across all admin locales.',
        en: 'Durable FAQ + GEO journey fixture description long enough to satisfy the answer-first signal across all admin locales.',
        fr: "Fixture du parcours FAQ et GEO, avec une description assez longue pour franchir le signal reponse-d'abord dans toutes les langues de l'admin.",
      },
      shortDescription: {
        default: 'FAQ GEO fixture short copy.',
        en: 'FAQ GEO fixture short copy.',
        fr: 'Texte court de la fixture FAQ et GEO.',
      },
      metaTitle: {
        default: `FAQ-GEO ${slug}`,
        en: `FAQ-GEO ${slug}`,
        fr: `FAQ-GEO ${slug}`,
      },
      metaDescription: {
        default: 'FAQ + GEO journey meta description long enough to pass schema completeness.',
        en: 'FAQ + GEO journey meta description long enough to pass schema completeness.',
        fr: 'Meta description du parcours FAQ et GEO, assez longue pour franchir le signal de completude du balisage.',
      },
      variants: [{ sku: `SKU-${slug}`, price: 100, isDefault: true, isActive: true }],
    },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[product-faqs-geo.journey] seed product failed: ${res.status()} ${raw.slice(0, 200)}`,
    );
  }
  const { data } = JSON.parse(raw) as { data: { id: string; slug: string } };
  return { id: data.id, slug: data.slug };
}

async function softDeleteProduct(baseURL: string, id: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.delete(`/api/v1/admin/products/${id}`, {
    headers: { Cookie: cookies },
  });
  await ctx.dispose();
  if (res.status() !== 204 && res.status() !== 404) {
    throw new Error(`[product-faqs-geo.journey] DELETE /products/${id} failed: ${res.status()}`);
  }
}

async function seedFaq(
  baseURL: string,
  productId: string,
  question: string,
  answer: string,
): Promise<string> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post(`/api/v1/admin/products/${productId}/faqs`, {
    headers: { Cookie: cookies },
    data: {
      question: { default: question, en: question },
      answer: { default: answer, en: answer },
    },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[product-faqs-geo.journey] seed FAQ failed: ${res.status()} ${raw.slice(0, 200)}`,
    );
  }
  const { data } = JSON.parse(raw) as { data: { id: string } };
  return data.id;
}

test('product detail renders per-product GEO suggestions, not a store score', async ({
  page,
  baseURL,
}) => {
  const seeded = await seedProduct(baseURL!);
  try {
    await page.goto(`/products/${seeded.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="product-detail-page"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="product-geo-panel"]')).toBeVisible();
    // Finding E4: the store-wide score lives on /seo/health now.
    await expect(page.locator('[data-testid="product-geo-score"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="product-geo-panel"]')).not.toContainText(
      'Store-wide score',
    );

    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });
  } finally {
    await softDeleteProduct(baseURL!, seeded.id);
  }
});

test('accept GEO suggestions persists faqs + refreshes FAQ panel', async ({ page, baseURL }) => {
  const seeded = await seedProduct(baseURL!);
  try {
    await page.goto(`/products/${seeded.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="product-geo-panel"]')).toBeVisible();

    const acceptBtn = page.locator('[data-testid="product-geo-accept-button"]');
    await expect(acceptBtn).toBeVisible();
    await acceptBtn.click();

    await expect(page.locator('[data-testid^="product-faq-card-"]').first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="product-geo-status"]')).toContainText(
      /accepted|added/i,
    );
  } finally {
    await softDeleteProduct(baseURL!, seeded.id);
  }
});

test('create FAQ inline surfaces a new card', async ({ page, baseURL }) => {
  const seeded = await seedProduct(baseURL!);
  try {
    await page.goto(`/products/${seeded.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="product-detail-page"]')).toBeVisible();

    await page.locator('[data-testid="product-faq-add"]').click();
    await page
      .locator('[data-testid="product-faq-question-input"] input')
      .fill('What is shipping?');
    await page
      .locator('[data-testid="product-faq-answer-input"] textarea')
      .fill('Shipping is calculated at checkout based on your address.');
    await page.locator('[data-testid="product-faq-save"]').click();

    await expect(page.locator('[data-testid^="product-faq-card-"]').first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="product-faq-status"]')).toContainText(
      /created|added/i,
    );
  } finally {
    await softDeleteProduct(baseURL!, seeded.id);
  }
});

test('edit FAQ inline updates the card copy', async ({ page, baseURL }) => {
  const seeded = await seedProduct(baseURL!);
  try {
    const faqId = await seedFaq(baseURL!, seeded.id, 'Origin?', 'Made in France.');
    await page.goto(`/products/${seeded.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator(`[data-testid="product-faq-card-${faqId}"]`)).toBeVisible();

    await page.locator(`[data-testid="product-faq-edit-${faqId}"]`).click();
    await page
      .locator('[data-testid="product-faq-answer-input"] textarea')
      .fill('Handcrafted in Lyon, France, by skilled artisans.');
    await page.locator('[data-testid="product-faq-save"]').click();

    await expect(page.locator(`[data-testid="product-faq-card-${faqId}"]`)).toContainText(/Lyon/, {
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="product-faq-status"]')).toContainText(
      /updated|saved/i,
    );
  } finally {
    await softDeleteProduct(baseURL!, seeded.id);
  }
});

test('delete FAQ via confirm dialog removes the card', async ({ page, baseURL }) => {
  const seeded = await seedProduct(baseURL!);
  try {
    const faqId = await seedFaq(baseURL!, seeded.id, 'Returns?', 'Free returns within 30 days.');
    await page.goto(`/products/${seeded.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator(`[data-testid="product-faq-card-${faqId}"]`)).toBeVisible();

    await page.locator(`[data-testid="product-faq-delete-${faqId}"]`).click();
    await expect(page.locator('[data-testid="confirm-dialog-confirm"]')).toBeVisible();
    await page.locator('[data-testid="confirm-dialog-confirm"]').click();

    await expect(page.locator(`[data-testid="product-faq-card-${faqId}"]`)).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="product-faq-status"]')).toContainText(
      /deleted|removed/i,
    );
  } finally {
    await softDeleteProduct(baseURL!, seeded.id);
  }
});
