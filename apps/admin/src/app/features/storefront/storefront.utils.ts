import { humanizeCode } from '../../shared/format/enum-label';

/**
 * Curated, operator-facing labels for the storefront `SectionType` enum.
 * Unknown codes fall back to {@link humanizeCode} so a newly-shipped section
 * type still reads sensibly before this map is updated.
 */
export const SECTION_TYPE_LABELS: Record<string, string> = {
  HERO: 'Hero banner',
  PROMOTIONAL_BANNER: 'Promotional banner',
  CATEGORY_SHOWCASE: 'Category showcase',
  FEATURED_PRODUCTS: 'Featured products',
  TRUST_SIGNALS: 'Trust signals',
};

/** Friendly label for a storefront section type (e.g. HERO → "Hero banner"). */
export function sectionTypeLabel(type: string | null | undefined): string {
  if (type == null) return '—';
  return SECTION_TYPE_LABELS[type] ?? humanizeCode(type);
}
