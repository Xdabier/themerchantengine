import { z } from 'zod';
import { entityIdSchema } from '../shared/ids';
import { resolvedStringSchema } from '../shared/translatable';
import { assetVariantsArraySchema } from '../shared/asset-variants';

/**
 * Storefront-side Zod for `GET /v1/storefront/sections/:pageSlug`. Mirrors
 * the resolved shape the API emits — `Translatable` JSONB has been collapsed
 * to a string by the global Accept-Language interceptor (constitution §3.2),
 * and per-type configs that hold `assetId` references receive an injected
 * sibling `assetUrl` from `StorefrontConfigService.hydrateAssetUrls`.
 *
 * The discriminated union keys on `type` so a `switch` over the parsed result
 * narrows to the matching component-map entry per DR-05. Every config schema
 * `.passthrough()` is intentional — additive backend fields cross over without
 * forcing a storefront redeploy.
 */

export const SECTION_TYPES = [
  'HERO',
  'PROMOTIONAL_BANNER',
  'CATEGORY_SHOWCASE',
  'FEATURED_PRODUCTS',
  'TRUST_SIGNALS',
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];
export const sectionTypeSchema = z.enum(SECTION_TYPES);

export const FEATURED_PRODUCTS_VARIANTS = ['scroll', 'grid'] as const;
export type FeaturedProductsVariant = (typeof FEATURED_PRODUCTS_VARIANTS)[number];

export const TRUST_PILLAR_KINDS = ['delivery', 'returns', 'authentic', 'support'] as const;
export type TrustPillarKind = (typeof TRUST_PILLAR_KINDS)[number];

/**
 * `assetUrl` is the canonical-variant URL injected by
 * `StorefrontConfigService.hydrateAssetUrls` (the `large` webp variant URL
 * post-AV1 cutover). `assetVariants` is the full responsive variant set per
 * `agent_docs/assets-pipeline.md` §5; storefront consumers feed it to
 * `pickVariant(...)` to build a `<picture>` source ladder. Optional during the
 * cutover window per DR-04 amendment 2026-05-01.
 */
const heroConfigSchema = z
  .object({
    assetId: entityIdSchema,
    assetUrl: z.string().optional(),
    assetVariants: assetVariantsArraySchema.optional(),
    eyebrow: resolvedStringSchema,
    headline: resolvedStringSchema,
    body: resolvedStringSchema,
    cta: resolvedStringSchema,
    ctaHref: z.string(),
    imageAlt: resolvedStringSchema.optional(),
  })
  .passthrough();
export type HeroSectionConfig = z.infer<typeof heroConfigSchema>;

const promotionalBannerConfigSchema = z
  .object({
    assetId: entityIdSchema,
    assetUrl: z.string().optional(),
    assetVariants: assetVariantsArraySchema.optional(),
    eyebrow: resolvedStringSchema,
    headline: resolvedStringSchema,
    body: resolvedStringSchema,
    cta: resolvedStringSchema.nullable().optional(),
    ctaHref: z.string().nullable().optional(),
    imageAlt: resolvedStringSchema.optional(),
  })
  .passthrough();
export type PromotionalBannerConfig = z.infer<typeof promotionalBannerConfigSchema>;

const categoryShowcaseConfigSchema = z
  .object({
    categoryIds: z.array(entityIdSchema).min(1).max(12),
    heading: resolvedStringSchema.optional(),
  })
  .passthrough();
export type CategoryShowcaseConfig = z.infer<typeof categoryShowcaseConfigSchema>;

const featuredProductsConfigSchema = z
  .object({
    productIds: z.array(entityIdSchema).min(1).max(12),
    variant: z.enum(FEATURED_PRODUCTS_VARIANTS),
    heading: resolvedStringSchema.optional(),
    eyebrow: resolvedStringSchema.optional(),
  })
  .passthrough();
export type FeaturedProductsConfig = z.infer<typeof featuredProductsConfigSchema>;

const trustSignalItemSchema = z
  .object({
    kind: z.enum(TRUST_PILLAR_KINDS),
    title: resolvedStringSchema,
    subtitle: resolvedStringSchema,
  })
  .passthrough();
export type TrustSignalItem = z.infer<typeof trustSignalItemSchema>;

const trustSignalsConfigSchema = z
  .object({
    items: z.array(trustSignalItemSchema).min(1).max(6),
  })
  .passthrough();
export type TrustSignalsConfig = z.infer<typeof trustSignalsConfigSchema>;

/**
 * Discriminated row union per `type`. The base envelope (id, pageSlug,
 * sortOrder, etc.) is fixed across types; only `config` varies.
 */
const baseSectionFields = {
  id: entityIdSchema,
  pageSlug: z.string(),
  title: resolvedStringSchema.nullable().optional(),
  sortOrder: z.number().int().nonnegative(),
  isVisible: z.boolean(),
  visibleFrom: z.string().nullable().optional(),
  visibleUntil: z.string().nullable().optional(),
};

export const heroSectionSchema = z
  .object({ ...baseSectionFields, type: z.literal('HERO'), config: heroConfigSchema })
  .passthrough();
export const promotionalBannerSectionSchema = z
  .object({
    ...baseSectionFields,
    type: z.literal('PROMOTIONAL_BANNER'),
    config: promotionalBannerConfigSchema,
  })
  .passthrough();
export const categoryShowcaseSectionSchema = z
  .object({
    ...baseSectionFields,
    type: z.literal('CATEGORY_SHOWCASE'),
    config: categoryShowcaseConfigSchema,
  })
  .passthrough();
export const featuredProductsSectionSchema = z
  .object({
    ...baseSectionFields,
    type: z.literal('FEATURED_PRODUCTS'),
    config: featuredProductsConfigSchema,
  })
  .passthrough();
export const trustSignalsSectionSchema = z
  .object({
    ...baseSectionFields,
    type: z.literal('TRUST_SIGNALS'),
    config: trustSignalsConfigSchema,
  })
  .passthrough();

export const storefrontSectionSchema = z.discriminatedUnion('type', [
  heroSectionSchema,
  promotionalBannerSectionSchema,
  categoryShowcaseSectionSchema,
  featuredProductsSectionSchema,
  trustSignalsSectionSchema,
]);
export type StorefrontSection = z.infer<typeof storefrontSectionSchema>;

export const storefrontSectionsMetaSchema = z.object({
  pageSlug: z.string(),
  total: z.number().int().nonnegative(),
});
export type StorefrontSectionsMeta = z.infer<typeof storefrontSectionsMetaSchema>;

export const storefrontSectionsResponseSchema = z.object({
  data: z.array(storefrontSectionSchema),
  meta: storefrontSectionsMetaSchema,
});
export type StorefrontSectionsResponse = z.infer<typeof storefrontSectionsResponseSchema>;
