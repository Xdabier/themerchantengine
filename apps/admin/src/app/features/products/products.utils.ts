import type { BadgeTone } from '@admin-ui';
import type { Product, Variant } from '@admin-services';
import { pickTranslation, type Translatable } from '@admin-types';

/** Prisma `ProductStatus` enum → brand-approved badge tone. */
export function productStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'DRAFT':
      return 'warning';
    case 'ARCHIVED':
      return 'error';
    default:
      return 'neutral';
  }
}

/** Tone for the backend `qualityScore.grade` bucket. */
export function qualityTone(grade: string | undefined): BadgeTone {
  switch (grade) {
    case 'green':
      return 'success';
    case 'yellow':
    case 'amber':
      return 'warning';
    case 'red':
      return 'error';
    default:
      return 'neutral';
  }
}

/**
 * Resolve a Translatable to a single visible string, with the admin's em-dash
 * placeholder for an empty one.
 *
 * A thin wrapper over `pickTranslation`, which is the canonical reducer. This
 * used to be a fourth independent copy of it whose `preferredLocale` defaulted
 * to `en`, so every call site that did not pass one rendered English whatever
 * the operator had selected. `locale` is required for that reason.
 */
export function pickTranslatable(value: unknown, locale: string, defaultLocale: string): string {
  return pickTranslation(
    value as Translatable | string | null | undefined,
    locale,
    '—',
    defaultLocale,
  );
}

/**
 * Tells admin-authored rich text apart from legacy plain text.
 *
 * Two content generations share the description field. Anything saved through
 * the WYSIWYG is sanitized HTML and has to render as elements; everything
 * seeded before that editor existed is plain text whose paragraphs are `\n`
 * breaks, and HTML rendering swallows those. Neither treatment is right for
 * both, and the operator sees the wrong one either way.
 *
 * The test names the sanitizer allow-list rather than looking for a bare `<`,
 * because product copy legitimately contains comparisons like "angle < 30
 * degres". Mirrors apps/storefront/src/lib/rich-text.ts.
 */
const RICH_TEXT_TAG = /<\/?(?:p|br|strong|em|a|ul|ol|li|h[1-4])(?:\s[^>]*)?\/?>/i;

export function looksLikeRichTextHtml(value: string | null | undefined): boolean {
  return typeof value === 'string' && RICH_TEXT_TAG.test(value);
}

/**
 * Resolve a product's default variant — the one flagged `isDefault: true`
 * or, failing that, the first variant. Returns `null` when the product
 * has no variants at all (which disqualifies it from bulk price updates).
 */
export function defaultVariantFor(product: Product): Variant | null {
  const variants = product.variants ?? [];
  if (variants.length === 0) return null;
  return variants.find((v) => v.isDefault) ?? variants[0] ?? null;
}

// `formatProductMoney` is gone. Product prices are in the store currency, so
// the pages render them with the shared `money` pipe, which reads CurrencyStore.
// The local copy defaulted to dollars, which is what showed US$100.00 to a
// euro store.
