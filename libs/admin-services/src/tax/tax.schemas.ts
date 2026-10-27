import * as z from 'zod';
import {
  entityIdSchema,
  paginationMetaSchema,
  resolvedStringSchema,
  translatableSchema,
} from '@admin-types';

const iso2 = z.string().regex(/^[A-Z]{2}$/);

/**
 * Tax rates are Prisma.Decimal on the wire (`"0.05"`) — coerce to number and
 * bound to the decimal-fraction range. Downstream: `rate: number`.
 */
const rateFraction = z
  .union([z.number(), z.string().transform((s) => Number(s))])
  .pipe(z.number().min(0).max(1));

export const taxZoneSchema = z.object({
  id: entityIdSchema,
  /**
   * Translatable per E5 + DR-21 — interceptor resolves to a single string on
   * default reads, returns the full `{ default, fr, en }` object when the
   * caller sends `X-Resolve-Locale: false`. Accept both shapes via the
   * resolvedStringSchema union.
   */
  name: resolvedStringSchema,
  countries: z.array(iso2),
  rate: rateFraction,
  isDefault: z.boolean().optional(),
  isCompound: z.boolean().optional(),
  priority: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});
export type TaxZone = z.infer<typeof taxZoneSchema>;

export const taxClassSchema = z.object({
  id: entityIdSchema,
  zoneId: entityIdSchema,
  /** Plain string per DR-22 — functional type-tag, not a display label. */
  name: z.string(),
  rate: rateFraction,
  isDefault: z.boolean().optional(),
});
export type TaxClass = z.infer<typeof taxClassSchema>;

export const listPaginatedQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});
export type ListPaginatedQuery = z.infer<typeof listPaginatedQuerySchema>;

export const listClassesQuerySchema = listPaginatedQuerySchema.extend({
  zoneId: entityIdSchema.optional(),
});
export type ListTaxClassesQuery = z.infer<typeof listClassesQuerySchema>;

export const listZonesResponseSchema = z.object({
  data: z.array(taxZoneSchema),
  meta: paginationMetaSchema,
});
export type ListTaxZonesResponse = z.infer<typeof listZonesResponseSchema>;

export const listClassesResponseSchema = z.object({
  data: z.array(taxClassSchema),
  meta: paginationMetaSchema,
});
export type ListTaxClassesResponse = z.infer<typeof listClassesResponseSchema>;

export const createTaxZoneRequestSchema = z.object({
  /**
   * Translatable name per E5 — admin form submits `{ default, en?, ar? }`.
   * `.refine` keeps the pre-E5 "non-empty default" contract that the backend's
   * `TranslatableDto` enforces via `@IsNotEmpty()` on the `default` field.
   */
  name: translatableSchema.refine((t) => t.default.length > 0, {
    message: 'name.default cannot be empty',
  }),
  countries: z.array(iso2).nonempty(),
  rate: rateFraction,
  isDefault: z.boolean().optional(),
  isCompound: z.boolean().optional(),
  priority: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});
export type CreateTaxZoneRequest = z.infer<typeof createTaxZoneRequestSchema>;

export const updateTaxZoneRequestSchema = createTaxZoneRequestSchema.partial();
export type UpdateTaxZoneRequest = z.infer<typeof updateTaxZoneRequestSchema>;

export const createTaxClassRequestSchema = z.object({
  zoneId: entityIdSchema,
  name: z.string().min(1),
  rate: rateFraction,
  isDefault: z.boolean().optional(),
});
export type CreateTaxClassRequest = z.infer<typeof createTaxClassRequestSchema>;
