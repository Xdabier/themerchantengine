import * as z from 'zod';
import { entityIdSchema, paginationMetaSchema, translatableSchema } from '@admin-types';

/** Prisma enums — keep as open string unions when backend docs are loose. */
export const promotionTypeSchema = z.enum([
  'PERCENTAGE',
  'FIXED_AMOUNT',
  'FREE_SHIPPING',
  'BUY_X_GET_Y',
  'VOLUME_DISCOUNT',
  'TIERED_PRICE',
]);
export type PromotionType = z.infer<typeof promotionTypeSchema>;

export const promotionApplicationSchema = z.enum(['COUPON', 'AUTOMATIC']);
export type PromotionApplicationMethod = z.infer<typeof promotionApplicationSchema>;

/** Prisma.Decimal columns serialise as strings — coerce to number. */
const coercedMoney = z.union([z.number(), z.string().transform((s) => Number(s))]);

export const promotionSchema = z.object({
  id: entityIdSchema,
  name: translatableSchema,
  description: translatableSchema.nullable().optional(),
  type: promotionTypeSchema,
  applicationMethod: promotionApplicationSchema,
  couponCode: z.string().nullable().optional(),
  value: coercedMoney,
  minimumOrderAmount: coercedMoney.nullable().optional(),
  maximumDiscount: coercedMoney.nullable().optional(),
  usageLimit: z.number().int().nonnegative().nullable().optional(),
  usageLimitPerUser: z.number().int().nonnegative().nullable().optional(),
  usageCount: z.number().int().nonnegative().nullable().optional(),
  isExclusive: z.boolean().optional(),
  priority: z.number().int().nonnegative().optional(),
  buyQuantity: z.number().int().nullable().optional(),
  getQuantity: z.number().int().nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean(),
  eligibleProducts: z.array(z.object({ productId: entityIdSchema })).optional(),
  eligibleCategories: z.array(z.object({ categoryId: entityIdSchema })).optional(),
});
export type Promotion = z.infer<typeof promotionSchema>;

export const listPromotionsQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  type: promotionTypeSchema.optional(),
  applicationMethod: promotionApplicationSchema.optional(),
  isActive: z.boolean().optional(),
});
export type ListPromotionsQuery = z.infer<typeof listPromotionsQuerySchema>;

export const listPromotionsResponseSchema = z.object({
  data: z.array(promotionSchema),
  meta: paginationMetaSchema,
});
export type ListPromotionsResponse = z.infer<typeof listPromotionsResponseSchema>;

export const createPromotionRequestSchema = z.object({
  name: translatableSchema,
  description: translatableSchema.optional(),
  type: promotionTypeSchema,
  applicationMethod: promotionApplicationSchema,
  couponCode: z.string().optional(),
  value: z.number().nonnegative(),
  minimumOrderAmount: z.number().nonnegative().optional(),
  maximumDiscount: z.number().nonnegative().optional(),
  usageLimit: z.number().int().positive().optional(),
  usageLimitPerUser: z.number().int().positive().optional(),
  isExclusive: z.boolean().optional(),
  priority: z.number().int().nonnegative().optional(),
  buyQuantity: z.number().int().positive().optional(),
  getQuantity: z.number().int().positive().optional(),
  tierConfig: z.unknown().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  isActive: z.boolean().optional(),
  eligibleProductIds: z.array(entityIdSchema).optional(),
  eligibleCategoryIds: z.array(entityIdSchema).optional(),
});
export type CreatePromotionRequest = z.infer<typeof createPromotionRequestSchema>;

export const updatePromotionRequestSchema = createPromotionRequestSchema.partial();
export type UpdatePromotionRequest = z.infer<typeof updatePromotionRequestSchema>;
