import { z } from 'zod';
import { entityIdSchema, paginationMetaSchema, translatableSchema } from '@admin-types';

export const paymentProviderSchema = z.enum(['stripe', 'paypal', 'cod', 'manual', 'gift_card']);
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;

export const paymentMethodSchema = z.object({
  id: entityIdSchema,
  code: z.string(),
  name: translatableSchema,
  description: translatableSchema.nullable().optional(),
  provider: paymentProviderSchema,
  isActive: z.boolean(),
  isTestMode: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
  /** Secrets arrive masked as `***`; non-secret keys pass through as-is. */
  config: z.record(z.string(), z.unknown()),
  createdAt: z.union([z.string().datetime(), z.date()]).optional(),
  updatedAt: z.union([z.string().datetime(), z.date()]).optional(),
});
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const listPaymentMethodsQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  provider: paymentProviderSchema.optional(),
  isActive: z.boolean().optional(),
});
export type ListPaymentMethodsQuery = z.infer<typeof listPaymentMethodsQuerySchema>;

export const listPaymentMethodsResponseSchema = z.object({
  data: z.array(paymentMethodSchema),
  meta: paginationMetaSchema,
});
export type ListPaymentMethodsResponse = z.infer<typeof listPaymentMethodsResponseSchema>;

export const createPaymentMethodRequestSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'lowercase letters, digits, underscores only'),
  name: translatableSchema,
  description: translatableSchema.optional(),
  provider: paymentProviderSchema,
  isActive: z.boolean().optional(),
  isTestMode: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type CreatePaymentMethodRequest = z.infer<typeof createPaymentMethodRequestSchema>;

export const updatePaymentMethodRequestSchema = z.object({
  name: translatableSchema.optional(),
  description: translatableSchema.optional(),
  isActive: z.boolean().optional(),
  isTestMode: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type UpdatePaymentMethodRequest = z.infer<typeof updatePaymentMethodRequestSchema>;

export const reorderPaymentMethodsRequestSchema = z.object({
  ids: z.array(entityIdSchema).min(1).max(100),
});
export type ReorderPaymentMethodsRequest = z.infer<typeof reorderPaymentMethodsRequestSchema>;
