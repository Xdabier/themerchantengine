import { z } from 'zod';
import { entityIdSchema, translatableSchema } from '@admin-types';

/**
 * UUID v4 — Asset rows are explicitly UUID-keyed by `AssetsService.upload`
 * (`apps/api/src/modules/assets/assets.service.ts` overrides Prisma's default
 * `cuid()` with `uuidv4()`). The HERO + PROMOTIONAL_BANNER `assetId` fields
 * therefore use the strict `@IsUUID('4')` shape on the backend; mirror it
 * here. Category + Product IDs stay on the relaxed `entityIdSchema` because
 * they keep Prisma's `cuid()` default.
 */
const uuidV4Schema = z.string().uuid();

/**
 * Per-type config Zod schemas mirroring the backend DTO shapes at
 * `apps/api/src/modules/storefront-config/dto/configs/`. Each schema is the
 * SSOT for the admin sub-form Reactive Form value; the parent
 * `createSectionRequestSchema` / `updateSectionRequestSchema` discriminated
 * unions consume these.
 *
 * `whitelist + forbidNonWhitelisted` on the backend rejects unknown fields,
 * so the admin schemas use `.strict()` to mirror that contract — the same
 * payload that fails server-side fails client-side.
 */

/**
 * Site-relative path or absolute http(s) URL. Mirrors the backend
 * `apps/api/src/modules/storefront-config/dto/configs/cta-href.constants.ts`
 * regex per the S21 admin-security-reviewer H-2 finding. Schemeless
 * `//evil.com`, `javascript:`, `data:`, `vbscript:`, `file:`, and
 * backslash variants are rejected client-side so the same payload that
 * fails server-side also fails client-side.
 */
const CTA_HREF_SCHEME_REGEX = /^(\/[^/\\]|https?:\/\/)/;
const ctaHrefSchema = z
  .string()
  .min(1)
  .max(2000)
  .regex(CTA_HREF_SCHEME_REGEX, 'ctaHref must start with "/" or "https?://"');

export const heroSectionConfigSchema = z
  .object({
    assetId: uuidV4Schema,
    eyebrow: translatableSchema,
    headline: translatableSchema,
    body: translatableSchema,
    cta: translatableSchema,
    ctaHref: ctaHrefSchema,
    imageAlt: translatableSchema.optional(),
  })
  .strict();
export type HeroSectionConfig = z.infer<typeof heroSectionConfigSchema>;

export const promotionalBannerConfigSchema = z
  .object({
    assetId: uuidV4Schema,
    eyebrow: translatableSchema,
    headline: translatableSchema,
    body: translatableSchema,
    cta: translatableSchema.optional(),
    ctaHref: ctaHrefSchema.optional(),
    imageAlt: translatableSchema.optional(),
  })
  .strict();
export type PromotionalBannerConfig = z.infer<typeof promotionalBannerConfigSchema>;

export const categoryShowcaseConfigSchema = z
  .object({
    categoryIds: z.array(entityIdSchema).min(1).max(12),
    heading: translatableSchema.optional(),
  })
  .strict()
  .refine((cfg) => new Set(cfg.categoryIds).size === cfg.categoryIds.length, {
    message: 'categoryIds must be unique',
    path: ['categoryIds'],
  });
export type CategoryShowcaseConfig = z.infer<typeof categoryShowcaseConfigSchema>;

export const FEATURED_PRODUCTS_VARIANTS = ['scroll', 'grid'] as const;
export const featuredProductsVariantSchema = z.enum(FEATURED_PRODUCTS_VARIANTS);
export type FeaturedProductsVariant = z.infer<typeof featuredProductsVariantSchema>;

export const featuredProductsConfigSchema = z
  .object({
    productIds: z.array(entityIdSchema).min(1).max(12),
    variant: featuredProductsVariantSchema,
    heading: translatableSchema.optional(),
    eyebrow: translatableSchema.optional(),
  })
  .strict()
  .refine((cfg) => new Set(cfg.productIds).size === cfg.productIds.length, {
    message: 'productIds must be unique',
    path: ['productIds'],
  });
export type FeaturedProductsConfig = z.infer<typeof featuredProductsConfigSchema>;

export const TRUST_PILLAR_KINDS = ['delivery', 'returns', 'authentic', 'support'] as const;
export const trustPillarKindSchema = z.enum(TRUST_PILLAR_KINDS);
export type TrustPillarKind = z.infer<typeof trustPillarKindSchema>;

export const trustSignalItemSchema = z
  .object({
    kind: trustPillarKindSchema,
    title: translatableSchema,
    subtitle: translatableSchema,
  })
  .strict();
export type TrustSignalItem = z.infer<typeof trustSignalItemSchema>;

export const trustSignalsConfigSchema = z
  .object({
    items: z.array(trustSignalItemSchema).min(1).max(6),
  })
  .strict();
export type TrustSignalsConfig = z.infer<typeof trustSignalsConfigSchema>;
