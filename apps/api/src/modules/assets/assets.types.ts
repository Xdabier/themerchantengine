/**
 * Shared types for the assets module — re-used by the references endpoint
 * (S18, DR-07) and any consumer that aggregates asset usage.
 */

export const ASSET_REFERENCE_KINDS = [
  'product',
  'variant',
  'review',
  'return',
  'category',
  'section',
] as const;

export type AssetReferenceKind = (typeof ASSET_REFERENCE_KINDS)[number];

export interface AssetReferenceRow {
  kind: AssetReferenceKind;
  id: string;
  label: string;
  route: string;
}

export interface AssetReferences {
  products: AssetReferenceRow[];
  variants: AssetReferenceRow[];
  reviews: AssetReferenceRow[];
  returns: AssetReferenceRow[];
  categories: AssetReferenceRow[];
  /**
   * `StorefrontSection.config` JSONB references — empty in S18; S19 wires
   * the discovery query for per-type section schemas.
   */
  sections: AssetReferenceRow[];
  total: number;
}

/**
 * Error code returned by `DELETE /v1/admin/assets/:id` when references > 0.
 * Per DR-07 — the operator must clear references via the references dialog
 * before the asset can be hard-deleted.
 */
export const ASSET_REFERENCED_ERROR_CODE = 'ASSET_REFERENCED';
