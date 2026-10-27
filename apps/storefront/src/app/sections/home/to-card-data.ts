import { pickTranslation, type ProductSummary, type ResolvedString } from '@storefront-types';

import type { Locale } from '../../../i18n/types';
import { APP_ROUTES } from '../../../lib/routes';
import { pictureSourcesFromAssetVariants } from '../../../lib/asset-variant';
import { noImageFallback } from '../../../lib/no-image';
import { productAvailability } from '../../../lib/availability';
import type { ProductCardData } from '../../ui/product-card.component';

/**
 * Map a `ProductSummary` (storefront-types) to the `ProductCardData` input
 * shape consumed by `<app-product-card />`. Resolves the translatable name to
 * the active locale, picks the primary asset url (or the no-image fallback),
 * and normalises the variant price + compareAtPrice into JS numbers.
 *
 * The no-image fallback is a single text-free placeholder, so any product
 * missing imagery still renders an intentional empty state rather than a
 * broken `<img>`, in either locale.
 */
export function toCardData(
  product: ProductSummary,
  locale: Locale,
  deliveryEstimate: string,
  /**
   * The store's configured currency, for the products the API sends no
   * currency for, which is all of them today. A pure function cannot inject
   * `StoreConfigService`, so the calling component passes the code down.
   */
  storeCurrency: string,
): ProductCardData {
  const name = pickTranslation(product.name as ResolvedString, locale);
  const altSource = product.primaryAsset?.altText
    ? pickTranslation(product.primaryAsset.altText as ResolvedString, locale)
    : name;
  const primaryVariant = product.variants?.[0];
  // Null, never a zero floor: a rail row with no resolvable price renders no
  // price line rather than a wrong one. See `ProductCardData.price`.
  const price = numericPrice(primaryVariant?.price ?? product.minPrice);
  const compareAt = primaryVariant?.compareAtPrice
    ? numericPrice(primaryVariant.compareAtPrice)
    : null;
  const cardSizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw';
  const imageSources = pictureSourcesFromAssetVariants(
    product.primaryAsset?.assetVariants,
    cardSizes,
  );
  return {
    productId: product.id,
    slug: product.slug,
    title: name,
    href: APP_ROUTES.product(locale, product.slug),
    imageSrc: product.primaryAsset?.url || noImageFallback(),
    imageAlt: altSource,
    imageSources: imageSources.length > 0 ? imageSources : undefined,
    price,
    compareAtPrice: compareAt,
    currency: product.currency ?? storeCurrency,
    availability: productAvailability(product.variants),
    deliveryEstimate,
  };
}

function numericPrice(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}
