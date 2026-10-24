import { describe, expect, it } from 'vitest';
import {
  SECTION_TYPES,
  storefrontSectionSchema,
  storefrontSectionsResponseSchema,
} from './sections.schemas';

const heroRow = () => ({
  id: 'sec-1',
  pageSlug: 'home',
  type: 'HERO' as const,
  sortOrder: 0,
  isVisible: true,
  title: null,
  visibleFrom: null,
  visibleUntil: null,
  config: {
    assetId: 'asset-1',
    assetUrl: 'https://cdn/hero.webp',
    eyebrow: 'Spring',
    headline: 'New season',
    body: 'Just landed',
    cta: 'Shop now',
    ctaHref: '/catalog',
  },
});

describe('storefrontSectionSchema (discriminated union)', () => {
  it('accepts each surviving type per DR-05', () => {
    expect(SECTION_TYPES).toEqual([
      'HERO',
      'PROMOTIONAL_BANNER',
      'CATEGORY_SHOWCASE',
      'FEATURED_PRODUCTS',
      'TRUST_SIGNALS',
    ]);
  });

  it('parses a HERO row with hydrated assetUrl', () => {
    expect(() => storefrontSectionSchema.parse(heroRow())).not.toThrow();
  });

  it('rejects a HERO config that lacks assetId', () => {
    const row = heroRow();
    delete (row.config as { assetId?: string }).assetId;
    expect(() => storefrontSectionSchema.parse(row)).toThrow();
  });

  it('parses a TRUST_SIGNALS row with one delivery pillar', () => {
    expect(() =>
      storefrontSectionSchema.parse({
        id: 'sec-2',
        pageSlug: 'home',
        type: 'TRUST_SIGNALS',
        sortOrder: 1,
        isVisible: true,
        config: {
          items: [{ kind: 'delivery', title: 'Fast', subtitle: 'Two-day' }],
        },
      }),
    ).not.toThrow();
  });

  it('rejects a TRUST_SIGNALS row with zero items', () => {
    expect(() =>
      storefrontSectionSchema.parse({
        id: 'sec-2',
        pageSlug: 'home',
        type: 'TRUST_SIGNALS',
        sortOrder: 1,
        isVisible: true,
        config: { items: [] },
      }),
    ).toThrow();
  });

  it('rejects a deprecated section type', () => {
    expect(() =>
      storefrontSectionSchema.parse({
        id: 'sec-3',
        pageSlug: 'home',
        type: 'TESTIMONIALS',
        sortOrder: 0,
        isVisible: true,
        config: {},
      }),
    ).toThrow();
  });

  it('parses a FEATURED_PRODUCTS row with the scroll variant', () => {
    expect(() =>
      storefrontSectionSchema.parse({
        id: 'sec-4',
        pageSlug: 'home',
        type: 'FEATURED_PRODUCTS',
        sortOrder: 2,
        isVisible: true,
        config: { productIds: ['p1', 'p2'], variant: 'scroll' },
      }),
    ).not.toThrow();
  });

  it('rejects a FEATURED_PRODUCTS row with an unknown variant', () => {
    expect(() =>
      storefrontSectionSchema.parse({
        id: 'sec-5',
        pageSlug: 'home',
        type: 'FEATURED_PRODUCTS',
        sortOrder: 3,
        isVisible: true,
        config: { productIds: ['p1'], variant: 'carousel' },
      }),
    ).toThrow();
  });

  it('parses a PROMOTIONAL_BANNER row', () => {
    expect(() =>
      storefrontSectionSchema.parse({
        id: 'sec-promo',
        pageSlug: 'home',
        type: 'PROMOTIONAL_BANNER',
        sortOrder: 4,
        isVisible: true,
        title: 'Promo',
        config: {
          assetId: 'asset-promo',
          assetUrl: 'https://cdn/promo.webp',
          eyebrow: 'Free delivery',
          headline: 'On orders over 200 EUR',
          body: 'No code needed.',
          cta: 'Shop',
          ctaHref: '/catalog',
        },
      }),
    ).not.toThrow();
  });

  it('rejects a PROMOTIONAL_BANNER without assetId', () => {
    expect(() =>
      storefrontSectionSchema.parse({
        id: 'sec-promo',
        pageSlug: 'home',
        type: 'PROMOTIONAL_BANNER',
        sortOrder: 4,
        isVisible: true,
        config: {
          eyebrow: 'no asset',
          headline: 'no asset',
          body: 'no asset',
        },
      }),
    ).toThrow();
  });

  it('parses a CATEGORY_SHOWCASE row with a heading + categoryIds', () => {
    expect(() =>
      storefrontSectionSchema.parse({
        id: 'sec-cat',
        pageSlug: 'home',
        type: 'CATEGORY_SHOWCASE',
        sortOrder: 1,
        isVisible: true,
        title: 'Shop by category',
        config: {
          categoryIds: ['cat-1', 'cat-2'],
          heading: 'Shop by category',
        },
      }),
    ).not.toThrow();
  });

  it('rejects a CATEGORY_SHOWCASE with an empty categoryIds array', () => {
    expect(() =>
      storefrontSectionSchema.parse({
        id: 'sec-cat-empty',
        pageSlug: 'home',
        type: 'CATEGORY_SHOWCASE',
        sortOrder: 1,
        isVisible: true,
        config: { categoryIds: [] },
      }),
    ).toThrow();
  });
});

describe('storefrontSectionsResponseSchema', () => {
  it('parses the wrapped envelope', () => {
    expect(() =>
      storefrontSectionsResponseSchema.parse({
        data: [heroRow()],
        meta: { pageSlug: 'home', total: 1 },
      }),
    ).not.toThrow();
  });

  it('rejects when meta.total is missing', () => {
    expect(() =>
      storefrontSectionsResponseSchema.parse({
        data: [heroRow()],
        meta: { pageSlug: 'home' },
      }),
    ).toThrow();
  });
});
