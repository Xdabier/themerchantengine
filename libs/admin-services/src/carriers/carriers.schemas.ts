import { z } from 'zod';
import { entityIdSchema, paginationMetaSchema, translatableSchema } from '@admin-types';

export const carrierProviderSchema = z.enum(['dhl', 'fedex', 'ups', 'aramex', 'manual']);
export type CarrierProvider = z.infer<typeof carrierProviderSchema>;

export const carrierSchema = z.object({
  id: entityIdSchema,
  code: z.string(),
  name: translatableSchema,
  provider: carrierProviderSchema,
  services: z.array(z.string()),
  zones: z.array(z.string()),
  isActive: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
  config: z.record(z.string(), z.unknown()),
  createdAt: z.union([z.string().datetime(), z.date()]).optional(),
  updatedAt: z.union([z.string().datetime(), z.date()]).optional(),
});
export type Carrier = z.infer<typeof carrierSchema>;

export const listCarriersQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  provider: carrierProviderSchema.optional(),
  isActive: z.boolean().optional(),
});
export type ListCarriersQuery = z.infer<typeof listCarriersQuerySchema>;

export const listCarriersResponseSchema = z.object({
  data: z.array(carrierSchema),
  meta: paginationMetaSchema,
});
export type ListCarriersResponse = z.infer<typeof listCarriersResponseSchema>;

export const createCarrierRequestSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9_]+$/),
  name: translatableSchema,
  provider: carrierProviderSchema,
  services: z.array(z.string()).max(50).optional(),
  zones: z
    .array(z.string().regex(/^[A-Z]{2}$/))
    .max(250)
    .optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type CreateCarrierRequest = z.infer<typeof createCarrierRequestSchema>;

export const updateCarrierRequestSchema = z.object({
  name: translatableSchema.optional(),
  services: z.array(z.string()).optional(),
  zones: z.array(z.string().regex(/^[A-Z]{2}$/)).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateCarrierRequest = z.infer<typeof updateCarrierRequestSchema>;
