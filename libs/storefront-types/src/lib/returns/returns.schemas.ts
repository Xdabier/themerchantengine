import { z } from 'zod';
import { returnReasonSchema, returnRefundMethodSchema, returnSchema } from '../shared/entities';

/**
 * Storefront returns schemas. Mirrors:
 * - `apps/api/src/modules/returns/dto/create-return.dto.ts:CreateReturnDto + ReturnItemDto`
 * - `apps/api/src/modules/returns/dto/query-returns.dto.ts:ListReturnsStorefrontDto`
 *
 * All endpoints `@OwnerGuard()` — server enforces caller-owns-order.
 */

export const returnItemRequestSchema = z
  .object({
    orderItemId: z.string().min(1),
    quantity: z.number().int().min(1),
    exchangeVariantId: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    // exchangeVariantId is required when refundMethod = EXCHANGE on the parent.
    // The cross-field check happens at the parent schema below.
    if (value.exchangeVariantId === undefined) return;
    if (value.exchangeVariantId.trim() === '') {
      ctx.addIssue({ code: 'custom', message: 'exchangeVariantId must not be blank' });
    }
  });
export type ReturnItemRequest = z.infer<typeof returnItemRequestSchema>;

export const createReturnRequestSchema = z
  .object({
    items: z.array(returnItemRequestSchema).min(1),
    reason: returnReasonSchema,
    reasonDetail: z.string().max(1000).optional(),
    photoAssetIds: z.array(z.string().min(1)).optional(),
    refundMethod: returnRefundMethodSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.refundMethod === 'EXCHANGE') {
      const missing = value.items.findIndex((item) => !item.exchangeVariantId);
      if (missing >= 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'exchangeVariantId is required for every item when refundMethod = EXCHANGE',
          path: ['items', missing, 'exchangeVariantId'],
        });
      }
    }
  });
export type CreateReturnRequest = z.infer<typeof createReturnRequestSchema>;

export const listReturnsQuerySchema = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).optional(),
});
export type ListReturnsQuery = z.infer<typeof listReturnsQuerySchema>;

export { returnSchema, returnReasonSchema, returnRefundMethodSchema };
export type {
  Return,
  ReturnReasonValue,
  ReturnRefundMethodValue,
  ReturnStatusValue,
} from '../shared/entities';
