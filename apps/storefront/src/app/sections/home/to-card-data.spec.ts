import { describe, expect, it } from 'vitest';

import type { ProductSummary } from '@storefront-types';

import { toCardData } from './to-card-data';

const VARIANTS = [
  { url: 'https://cdn/v-150.webp', width: 150, format: 'webp' as const },
  { url: 'https://cdn/v-150.avif', width: 150, format: 'avif' as const },
  { url: 'https://cdn/v-400.webp', width: 400, format: 'webp' as const },
  { url: 'https://cdn/v-400.avif', width: 400, format: 'avif' as const },
];

function product(overrides?: Partial<ProductSummary>): ProductSummary {
  return {
    id: 'prod-1',
    slug: 'echo-pro',
    name: 'Echo Pro',
    primaryAsset: {
      url: 'https://cdn/v-400.webp',
      type: 'IMAGE',
      altText: 'Echo Pro headphones',
      assetVariants: VARIANTS,
    },
    variants: [{ id: 'var-1', price: '199.00', stock: 5 }],
    currency: 'AED',
    ...overrides,
  } as ProductSummary;
}

describe('toCardData / AV4 picture sources', () => {
  it('builds imageSources from primaryAsset.assetVariants', () => {
    const card = toCardData(product(), 'en', 'Same-day delivery', 'LYD');
    expect(card.imageSources).toBeDefined();
    expect(card.imageSources).toHaveLength(2);
    expect(card.imageSources![0]!.type).toBe('image/avif');
    expect(card.imageSources![0]!.srcset).toContain('150w');
    expect(card.imageSources![0]!.srcset).toContain('400w');
    expect(card.imageSources![0]!.sizes).toBe(
      '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw',
    );
  });

  it('falls back to the no-image surface when primary asset is missing (en)', () => {
    const card = toCardData(product({ primaryAsset: null }), 'en', '', 'LYD');
    expect(card.imageSrc).toBe('/brand/no-image.svg');
    expect(card.imageSources).toBeUndefined();
  });

  it('falls back to the same no-image surface under fr', () => {
    const card = toCardData(product({ primaryAsset: null }), 'fr', '', 'LYD');
    expect(card.imageSrc).toBe('/brand/no-image.svg');
    expect(card.imageSources).toBeUndefined();
  });

  it('labels a product the API sent no currency for with the store currency', () => {
    // The API emits no per-product currency, so this argument is what every
    // catalogue card is actually labelled with (finding D5).
    const card = toCardData(product({ currency: undefined }), 'en', '', 'EUR');
    expect(card.currency).toBe('EUR');
  });

  it('keeps a currency the product carries of its own', () => {
    const card = toCardData(product({ currency: 'AED' }), 'en', '', 'EUR');
    expect(card.currency).toBe('AED');
  });

  it('omits imageSources when assetVariants payload is absent', () => {
    const card = toCardData(
      product({
        primaryAsset: { url: 'https://cdn/v-400.webp', type: 'IMAGE' },
      } as Partial<ProductSummary>),
      'en',
      '',
      'LYD',
    );
    expect(card.imageSrc).toBe('https://cdn/v-400.webp');
    expect(card.imageSources).toBeUndefined();
  });
});
