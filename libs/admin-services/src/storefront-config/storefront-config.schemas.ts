import { z } from 'zod';
import { entityIdSchema, paginationMetaSchema, translatableSchema } from '@admin-types';
import {
  categoryShowcaseConfigSchema,
  featuredProductsConfigSchema,
  heroSectionConfigSchema,
  promotionalBannerConfigSchema,
  trustSignalsConfigSchema,
} from './section-config.schemas';

export * from './section-config.schemas';

/**
 * Storefront section types — the five surviving values per DR-05. The
 * Prisma enum still carries ten values until the S21 cutover migration
 * drops the unused five; the admin DTO + this schema gate the admin write
 * surface so operators only see + create renderable types.
 */
export const sectionTypeSchema = z.enum([
  'HERO',
  'PROMOTIONAL_BANNER',
  'CATEGORY_SHOWCASE',
  'FEATURED_PRODUCTS',
  'TRUST_SIGNALS',
]);
export type SectionType = z.infer<typeof sectionTypeSchema>;

/**
 * Storefront-section response shape. The `config` JSONB is parsed against
 * the per-type discriminated union so consumers get a typed value rather
 * than `Record<string, unknown>`.
 */
const baseSectionFields = {
  id: entityIdSchema,
  pageSlug: z.string(),
  title: translatableSchema.nullable().optional(),
  sortOrder: z.number().int().nonnegative(),
  isVisible: z.boolean(),
  visibleFrom: z.string().datetime().nullable().optional(),
  visibleUntil: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
} as const;

export const storefrontSectionSchema = z.discriminatedUnion('type', [
  z.object({ ...baseSectionFields, type: z.literal('HERO'), config: heroSectionConfigSchema }),
  z.object({
    ...baseSectionFields,
    type: z.literal('PROMOTIONAL_BANNER'),
    config: promotionalBannerConfigSchema,
  }),
  z.object({
    ...baseSectionFields,
    type: z.literal('CATEGORY_SHOWCASE'),
    config: categoryShowcaseConfigSchema,
  }),
  z.object({
    ...baseSectionFields,
    type: z.literal('FEATURED_PRODUCTS'),
    config: featuredProductsConfigSchema,
  }),
  z.object({
    ...baseSectionFields,
    type: z.literal('TRUST_SIGNALS'),
    config: trustSignalsConfigSchema,
  }),
]);
export type StorefrontSection = z.infer<typeof storefrontSectionSchema>;

export const listSectionsQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});
export type ListSectionsQuery = z.infer<typeof listSectionsQuerySchema>;

export const listSectionsResponseSchema = z.object({
  data: z.array(storefrontSectionSchema),
  meta: paginationMetaSchema,
});
export type ListSectionsResponse = z.infer<typeof listSectionsResponseSchema>;

export const listPagesResponseSchema = z.object({
  data: z.array(z.string()),
});
export type ListPagesResponse = z.infer<typeof listPagesResponseSchema>;

/**
 * Slug regex matches the backend DTO: lowercase alphanumerics, hyphens, and slashes.
 * The leading slash is optional here because the value is passed as a URL path param.
 */
const pageSlugPattern = /^[a-z0-9][a-z0-9-/]*$/;

export const pageSlugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(pageSlugPattern, 'Invalid page slug');
export type PageSlug = z.infer<typeof pageSlugSchema>;

export const reorderSectionsRequestSchema = z.object({
  orderedIds: z.array(entityIdSchema).min(1),
});
export type ReorderSectionsRequest = z.infer<typeof reorderSectionsRequestSchema>;

const requestEnvelopeFields = {
  title: translatableSchema.optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  isVisible: z.boolean().optional(),
  visibleFrom: z.string().datetime().optional(),
  visibleUntil: z.string().datetime().optional(),
} as const;

/**
 * Discriminated-union create payload — one shape per surviving `SectionType`.
 * The matching backend DTO at `apps/api/src/modules/storefront-config/dto/`
 * runs the same validation server-side; both contracts must drift together.
 */
export const createSectionRequestSchema = z.discriminatedUnion('type', [
  z.object({
    ...requestEnvelopeFields,
    type: z.literal('HERO'),
    config: heroSectionConfigSchema,
  }),
  z.object({
    ...requestEnvelopeFields,
    type: z.literal('PROMOTIONAL_BANNER'),
    config: promotionalBannerConfigSchema,
  }),
  z.object({
    ...requestEnvelopeFields,
    type: z.literal('CATEGORY_SHOWCASE'),
    config: categoryShowcaseConfigSchema,
  }),
  z.object({
    ...requestEnvelopeFields,
    type: z.literal('FEATURED_PRODUCTS'),
    config: featuredProductsConfigSchema,
  }),
  z.object({
    ...requestEnvelopeFields,
    type: z.literal('TRUST_SIGNALS'),
    config: trustSignalsConfigSchema,
  }),
]);
export type CreateSectionRequest = z.infer<typeof createSectionRequestSchema>;

/**
 * Update payload — admin contract is "either replace the per-type config
 * wholesale (full `type` + `config` per the discriminated union) or patch
 * only the envelope (title / sortOrder / visibility window) with no `type`
 * or `config`". The split mirrors the backend's `dto.config` revalidation:
 * sending a `config` without a `type` would discard the type-context the
 * service needs to validate the JSONB shape, so the admin refuses that
 * payload before it reaches the wire.
 */
const updateSectionEnvelopePatchSchema = z.object(requestEnvelopeFields).strict();

export const updateSectionRequestSchema = z.union([
  updateSectionEnvelopePatchSchema,
  createSectionRequestSchema,
]);
export type UpdateSectionRequest = z.infer<typeof updateSectionRequestSchema>;

export const toggleVisibilityRequestSchema = z.object({
  isVisible: z.boolean(),
  visibleFrom: z.string().datetime().optional(),
  visibleUntil: z.string().datetime().optional(),
});
export type ToggleVisibilityRequest = z.infer<typeof toggleVisibilityRequestSchema>;

/**
 * Storefront page catalog — the legacy `StorefrontPage` shape kept for the
 * tree where the catalog gains title/label metadata. The live `listPages`
 * response is currently a bare slug array (`listPagesResponseSchema`).
 */
export const storefrontPageSchema = z.object({
  slug: z.string(),
  title: translatableSchema.optional(),
  label: z.string().optional(),
});
export type StorefrontPage = z.infer<typeof storefrontPageSchema>;

/**
 * The public origin and the shape of a product URL.
 *
 * `productPathTemplate` arrives as a template with `{locale}` and `{slug}`
 * placeholders, derived server-side from the same function the sitemap and the
 * canonical tag use. The admin substitutes rather than composing a path of its
 * own, which is what stops a deep link drifting from the advertised URL.
 */
export const storefrontPublicConfigSchema = z.object({
  baseUrl: z.string().url(),
  locales: z.array(z.string().min(2)).min(1),
  defaultLocale: z.string().min(2),
  productPathTemplate: z.string().min(1),
});
export type StorefrontPublicConfig = z.infer<typeof storefrontPublicConfigSchema>;
