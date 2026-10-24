import { z } from 'zod';
import { entityIdSchema, paginationMetaSchema, translatableSchema } from '@admin-types';

const iso2 = z.string().regex(/^[A-Z]{2}$/);

/** Prisma.Decimal columns serialise as strings; coerce to number downstream. */
const coercedMoney = z.union([z.number(), z.string().transform((s) => Number(s))]);

/** Zod tolerates both ISO strings (real API) and Date objects (HttpClientTestingModule flushes). */
const datetimeField = z.union([z.string().datetime(), z.date()]);

export const postalCodeRangeSchema = z
  .object({ from: z.string(), to: z.string() })
  .refine((r) => r.from <= r.to, { message: 'from must be <= to' });
export type PostalCodeRange = z.infer<typeof postalCodeRangeSchema>;

export const shippingZoneSchema = z.object({
  id: entityIdSchema,
  name: translatableSchema,
  countries: z.array(iso2),
  states: z.array(z.string()).nullable().optional(),
  postalCodeRanges: z
    .array(z.object({ from: z.string(), to: z.string() }))
    .nullable()
    .optional(),
  priority: z.number().int(),
  isActive: z.boolean(),
  createdAt: datetimeField,
  updatedAt: datetimeField,
});
export type ShippingZone = z.infer<typeof shippingZoneSchema>;

export const createShippingZoneRequestSchema = z.object({
  name: translatableSchema,
  countries: z.array(iso2).nonempty(),
  states: z.array(z.string()).optional(),
  postalCodeRanges: z.array(postalCodeRangeSchema).optional(),
  priority: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});
export type CreateShippingZoneRequest = z.infer<typeof createShippingZoneRequestSchema>;

export const updateShippingZoneRequestSchema = createShippingZoneRequestSchema.partial();
export type UpdateShippingZoneRequest = z.infer<typeof updateShippingZoneRequestSchema>;

/**
 * Mirror of Prisma `enum ShippingMethodType` — keep in sync with
 * prisma/schema.prisma:167.
 */
export const shippingMethodTypeSchema = z.enum([
  'FLAT_RATE',
  'WEIGHT_BASED',
  'PRICE_BASED',
  'CARRIER_CALCULATED',
  'FREE',
]);
export type ShippingMethodType = z.infer<typeof shippingMethodTypeSchema>;

const weightRangeSchema = z.object({
  minKg: z.number().nonnegative(),
  maxKg: z.number().nonnegative(),
  price: z.number().nonnegative(),
});
const priceRangeSchema = z.object({
  minAmount: z.number().nonnegative(),
  maxAmount: z.number().nonnegative(),
  price: z.number().nonnegative(),
});

export const shippingMethodSchema = z.object({
  id: entityIdSchema,
  zoneId: entityIdSchema,
  name: translatableSchema,
  type: shippingMethodTypeSchema,
  price: coercedMoney.nullable().optional(),
  weightRanges: z.array(weightRangeSchema).nullable().optional(),
  priceRanges: z.array(priceRangeSchema).nullable().optional(),
  freeAbove: coercedMoney.nullable().optional(),
  estimatedDaysMin: z.number().int().nullable().optional(),
  estimatedDaysMax: z.number().int().nullable().optional(),
  isActive: z.boolean(),
  /** Zone's preselected standard method (at most one per zone). */
  isDefault: z.boolean().optional().default(false),
  sortOrder: z.number().int(),
  createdAt: datetimeField,
  updatedAt: datetimeField,
  zone: z.object({ id: entityIdSchema, name: translatableSchema }).optional(),
});
export type ShippingMethod = z.infer<typeof shippingMethodSchema>;

export const createShippingMethodRequestSchema = z.object({
  zoneId: entityIdSchema,
  name: translatableSchema,
  type: shippingMethodTypeSchema,
  price: z.number().nonnegative().optional(),
  weightRanges: z.array(weightRangeSchema).optional(),
  priceRanges: z.array(priceRangeSchema).optional(),
  freeAbove: z.number().nonnegative().optional(),
  estimatedDaysMin: z.number().int().nonnegative().optional(),
  estimatedDaysMax: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});
export type CreateShippingMethodRequest = z.infer<typeof createShippingMethodRequestSchema>;

export const updateShippingMethodRequestSchema = createShippingMethodRequestSchema.partial();
export type UpdateShippingMethodRequest = z.infer<typeof updateShippingMethodRequestSchema>;

export const listPaginatedQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});
export type ListPaginatedQuery = z.infer<typeof listPaginatedQuerySchema>;

export const listMethodsQuerySchema = listPaginatedQuerySchema.extend({
  zoneId: entityIdSchema.optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});
export type ListMethodsQuery = z.infer<typeof listMethodsQuerySchema>;

export const listZonesResponseSchema = z.object({
  data: z.array(shippingZoneSchema),
  meta: paginationMetaSchema,
});
export type ListZonesResponse = z.infer<typeof listZonesResponseSchema>;

export const listMethodsResponseSchema = z.object({
  data: z.array(shippingMethodSchema),
  meta: paginationMetaSchema,
});
export type ListMethodsResponse = z.infer<typeof listMethodsResponseSchema>;
