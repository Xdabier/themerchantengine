import { expect, test } from '@playwright/test';

import { attachConsoleBaseline, type ConsoleBaseline } from './support';

/**
 * AV4 e2e gate — storefront `<picture>` variant consumption.
 *
 * Asserts that every surface migrated in AV4 (hero banner, product card,
 * product detail gallery) renders `<picture>` with at least one `<source>`
 * element carrying a `srcset`, and that the JSON-LD `Product` schema on the
 * product detail page emits `image` as a one-element array with a URL
 * matching the `large` variant.
 *
 * Runs against the real API + fixture-catalogue-seeded DB (no `page.route()`, no
 * MSW, no fixtures — constitution §3.8 + AV4 e2e gate spec). Requires the
 * fixture catalogue seed to have been re-run through the post-AV1 `ingestImage`
 * pipeline so assets have `variants` without the `original` key (AV4.15
 * staleness guard in `prisma/seeds/fixture-catalogue/lib/image-pipeline.ts`).
 *
 * These tests use the same `SECTION_TIMEOUT_MS` budget as
 * `home-section-driven.journey.spec.ts` because section-driven surfaces
 * require client-side hydration to fire after the SSR shell loads.
 */

/** 60 s ceiling absorbs Vite SSR dev-server cold-start + hydration. */
const SECTION_TIMEOUT_MS = 60_000;

/** Known fixture catalogue product slug — seeded by `prisma/seeds/fixture-catalogue/products.ts`. */
const SEEDED_PRODUCT_SLUG = 'fx-laptop-pro-16-studio';

/**
 * A category the fixture catalogue seed guarantees, with products that carry
 * assets. Named rather than discovered, because discovery on a shared database
 * finds whatever a sibling spec left behind.
 */
const SEEDED_CATEGORY_SLUG = 'fx-electronics';

/**
 * The one product in that category the seed plants with no picture on purpose
 * (`ASSETLESS_PRODUCT_SLUG` in `prisma/seeds/fixture-catalogue/products.ts`).
 * Its card renders the no-image fallback, which has no `<source>` by design.
 */
const ASSETLESS_PRODUCT_SLUG = 'fx-laptop-compact-12-se';

test.describe('AV4 — storefront <picture> variant srcset rendering', () => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  /**
   * Hero banner `<picture>` with `<source>` elements.
   *
   * The hero section's `config.assetVariants` array is populated by
   * `StorefrontConfigService.hydrateAssetUrls` when the seeded Asset has
   * `variants` (no `original` key). The storefront page passes
   * `pictureSourcesFromAssetVariants(config.assetVariants)` to
   * `<app-hero-banner [copy]>`, which forwards them to `<app-picture
   * [sources]>`. The `<picture>` element then emits one `<source>` per
   * format (avif first, then webp).
   */
  test('hero banner renders <picture> with at least one <source> after hydration', async ({
    page,
  }) => {
    await page.goto('/fr/');
    // Wait for the hero section to appear after client-side hydration.
    const hero = page.locator('[data-testid="home-hero"]').first();
    await expect(hero).toBeVisible({ timeout: SECTION_TIMEOUT_MS });

    // The hero image should be inside an <app-picture> which renders a
    // <picture> element. Verify at least one <source> with a srcset exists.
    const heroSource = hero.locator('picture source').first();
    await expect(heroSource).toBeAttached({ timeout: SECTION_TIMEOUT_MS });
    const srcset = await heroSource.getAttribute('srcset');
    expect(srcset, 'hero source[srcset] should be a non-empty string').toBeTruthy();
    // Each srcset entry for the seed assets has an S3 URL with 'seed-fixture-catalogue'
    // in the path — verify the srcset contains a real variant URL (not a
    // brand-mark placeholder).
    expect(srcset).toMatch(/\d+w/);
  });

  /**
   * Product card `<picture>` on the home page featured rail.
   *
   * The FEATURED_PRODUCTS section drives a product rail whose cards are
   * built via `toCardData`. When `product.primaryAsset.assetVariants` is
   * populated (post-AV4 seed), `imageSources` is passed to
   * `<app-product-card [data]>` which forwards to `<app-picture [sources]>`.
   */
  test('featured product card on home page renders <picture> with <source>', async ({ page }) => {
    await page.goto('/fr/');
    // Wait for a curated featured rail to load. B3 deleted the hardcoded
    // `home-popular` rail; the testid now carries the section id, so match the
    // prefix.
    const popularRail = page.locator('[data-testid^="home-featured-"]').first();
    await expect(popularRail).toBeVisible({ timeout: SECTION_TIMEOUT_MS });

    // Assert that at least one product card inside the popular rail has a
    // <picture> with a <source> element. The popular rail contains a mix of
    // fixture-catalogue-seeded products (which have assetVariants) and non-KH products
    // (iphone, samsung, sneakers) which fall back to the brand-mark SVG. The
    // test verifies the AV4 migration works on FX-seeded products by finding the
    // first source element in any card — not by constraining to card[0] which may
    // be a non-KH product depending on the DB sort order.
    const source = popularRail.locator('app-product-card picture source').first();
    await expect(source).toBeAttached({ timeout: SECTION_TIMEOUT_MS });
    const srcset = await source.getAttribute('srcset');
    expect(srcset, 'product card source[srcset] should be non-empty').toBeTruthy();
    expect(srcset).toMatch(/\d+w/);
  });

  /**
   * Category-page product card `<picture>` with `<source>`.
   *
   * Navigates via the category showcase tile to the first category's catalog
   * page and asserts the first product card has responsive `<source>` entries.
   */
  test('category catalog product card renders <picture> with <source>', async ({ page }) => {
    // A named seeded category, not whichever showcase tile happens to be
    // first. The test database is shared and long-lived, and specs that create
    // a category and fail to clean it up leave it behind: there are currently
    // fifteen with timestamped slugs, each holding one product with no image
    // at all. A card with no image renders the no-image fallback, which strips
    // the <source> ladder by design, so the tile-order dependency turned a
    // data-hygiene problem into what read as an AV4 regression. The seed's one
    // assetless product sits in this category too, so its card is skipped.
    await page.goto(`/en/catalog/${SEEDED_CATEGORY_SLUG}`);
    const grid = page.locator('[data-testid="catalog-grid"]').first();
    await expect(grid).toBeVisible({ timeout: 30_000 });
    const card = grid
      .locator('app-product-card')
      .filter({ hasNot: page.locator(`a[href$="/${ASSETLESS_PRODUCT_SLUG}"]`) })
      .first();

    // `picture.component.ts` removes every <source> when the <img> errors, on
    // purpose, so the browser cannot re-fetch a broken avif/webp variant. That
    // makes `toBeAttached()` a network assertion in disguise. Wait for the
    // image to have actually loaded first, so a failed fetch fails on the
    // image with a message that says so, instead of on a markup assertion
    // that reads as an AV4 regression.
    const firstCardImg = card.locator('picture img').first();
    await expect(firstCardImg).toBeAttached({ timeout: 15_000 });
    await firstCardImg.evaluate(
      (el: HTMLImageElement) =>
        el.complete ||
        new Promise((resolve) => {
          el.addEventListener('load', resolve, { once: true });
          el.addEventListener('error', resolve, { once: true });
        }),
    );
    // `complete && naturalWidth > 0` is not enough on its own: the component
    // swaps to `/brand/no-image.svg` when the real image errors, and that
    // fallback loads perfectly well. Asserting the rendered src is still the
    // product image is what separates "the ladder regressed" from "the seed's
    // image did not arrive".
    const rendered = await firstCardImg.evaluate((el: HTMLImageElement) => ({
      complete: el.complete && el.naturalWidth > 0,
      src: el.getAttribute('src') ?? '',
    }));
    expect(rendered.complete, 'the card image never finished loading').toBe(true);
    expect(
      rendered.src,
      'the card fell back to the no-image placeholder, which strips the <source> ladder by ' +
        'design, so this is the seed asset failing to load rather than an AV4 regression',
    ).not.toMatch(/no-image/);

    const firstCardSource = card.locator('picture source').first();
    await expect(firstCardSource).toBeAttached({ timeout: 15_000 });
    const srcset = await firstCardSource.getAttribute('srcset');
    expect(srcset, 'catalog card source[srcset] should be non-empty').toBeTruthy();
    expect(srcset).toMatch(/\d+w/);
  });

  /**
   * Product detail gallery `<picture>` with `<source>`.
   *
   * Navigates to a known seeded product detail page and asserts that the
   * `product-gallery` section contains a `<picture>` with `<source>` elements.
   * The gallery's `GalleryImage.sources` is populated via
   * `pictureSourcesFromAssetVariants(a.assetVariants, ...)`.
   */
  test('product detail gallery renders <picture> with <source>', async ({ page }) => {
    await page.goto(`/en/catalog/product/${SEEDED_PRODUCT_SLUG}`);
    const summary = page.locator('[data-testid="product-summary"]');
    await expect(summary).toBeVisible({ timeout: 15_000 });

    // The product-gallery selector is the Angular component host element.
    const gallery = page.locator('product-gallery').first();
    await expect(gallery).toBeVisible({ timeout: 10_000 });

    const gallerySource = gallery.locator('picture source').first();
    await expect(gallerySource).toBeAttached({ timeout: 10_000 });
    const srcset = await gallerySource.getAttribute('srcset');
    expect(srcset, 'gallery source[srcset] should be non-empty').toBeTruthy();
    expect(srcset).toMatch(/\d+w/);
  });

  /**
   * JSON-LD Product schema on product detail — Q6 decision.
   *
   * Per `specs/features/asset-variant-serving/clarifications.md` Q6, the
   * `Product.image` field carries a one-element array with the canonical
   * `large` variant URL. The storefront product detail page builds this in
   * `buildProductJsonLd` by using `primaryAsset.url` (which after AV1 IS
   * the large-webp variant URL). Verified here against the live seeded catalog.
   */
  test('product detail JSON-LD Product.image is a one-element array with a URL ending in large.webp', async ({
    page,
  }) => {
    await page.goto(`/en/catalog/product/${SEEDED_PRODUCT_SLUG}`);
    await expect(page.locator('[data-testid="product-summary"]')).toBeVisible({
      timeout: 15_000,
    });

    const scripts = page.locator('script[type="application/ld+json"][data-product-jsonld]');
    const count = await scripts.count();
    expect(count).toBeGreaterThanOrEqual(1);

    let productScript: string | null = null;
    for (let i = 0; i < count; i += 1) {
      const body = await scripts.nth(i).textContent();
      try {
        const parsed = JSON.parse(body ?? '{}') as { '@type'?: string };
        if (parsed['@type'] === 'Product') {
          productScript = body;
          break;
        }
      } catch {
        // skip malformed
      }
    }
    expect(productScript, 'Product JSON-LD script should be present').not.toBeNull();

    const productLd = JSON.parse(productScript ?? '{}') as {
      image?: unknown;
    };
    const imageArr = productLd.image;
    expect(Array.isArray(imageArr), 'Product.image should be an array').toBe(true);
    expect((imageArr as string[]).length, 'Product.image should be a one-element array').toBe(1);

    const imageUrl = (imageArr as string[])[0];
    expect(typeof imageUrl).toBe('string');
    // The URL must end with 'large.webp' — the canonical AV1 variant for the
    // 'detail' intent (large). See `INTENT_TO_VARIANT` in
    // `apps/storefront/src/lib/asset-variant.ts` + Q6 decision.
    expect(imageUrl, 'Product.image[0] should end with large.webp').toMatch(/large\.webp$/);
  });

  /**
   * Search page product card `<picture>` with `<source>`.
   *
   * Searches for a known fixture catalogue product keyword and asserts that the
   * first result card has `<source>` elements.
   */
  test('search result product card renders <picture> with <source>', async ({ page }) => {
    await page.goto('/en/search?q=laptop');
    const grid = page.locator('[data-testid="catalog-grid"]').first();
    await expect(grid).toBeVisible({ timeout: 15_000 });

    const firstCardSource = grid.locator('app-product-card picture source').first();
    await expect(firstCardSource).toBeAttached({ timeout: 15_000 });
    const srcset = await firstCardSource.getAttribute('srcset');
    expect(srcset, 'search result card source[srcset] should be non-empty').toBeTruthy();
    expect(srcset).toMatch(/\d+w/);
  });
});
