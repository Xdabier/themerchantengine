import type { Availability } from '@storefront-types';

export type { Availability } from '@storefront-types';

export interface AvailabilityBearingVariant {
  availability?: Availability | null;
  stock?: number | null;
}

/**
 * One variant's state.
 *
 * The API grades every variant server-side against the store's low-stock
 * threshold, so this never re-implements that rule. The public payload carries
 * the grade and deliberately not the count: an exact per-variant stock integer
 * on an unauthenticated endpoint makes the whole catalogue's inventory position
 * scrapable, and agent_docs/storefront/brand-tokens.md only ever asks for the three-state grade. The
 * `stock` fallback remains only so a payload that predates the grade degrades
 * to a truthful binary rather than to an empty render.
 */
export function variantAvailability(variant: AvailabilityBearingVariant | null): Availability {
  if (!variant) return 'OUT_OF_STOCK';
  if (variant.availability) return variant.availability;
  return (variant.stock ?? 0) > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK';
}

/**
 * The single state a product card shows for a whole product.
 *
 * Brand floor §9 keeps availability visible on every card and on the product
 * page, and §8.2 forbids hiding it behind a click. A card shows one product,
 * not one variant, so the variant states collapse to one answer: in stock when
 * any variant is, low when none is in stock but at least one is low, and out
 * otherwise.
 */
export function productAvailability(
  variants: readonly AvailabilityBearingVariant[] | null | undefined,
): Availability {
  const states = (variants ?? []).map(variantAvailability);
  if (states.includes('IN_STOCK')) return 'IN_STOCK';
  if (states.includes('LOW_STOCK')) return 'LOW_STOCK';
  return 'OUT_OF_STOCK';
}
