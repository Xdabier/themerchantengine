import * as z from 'zod';
import { entityIdSchema, paginationMetaSchema, translatableSchema } from '@admin-types';

/** Mirror of Prisma `enum ReturnStatus` — keep in sync with prisma/schema.prisma. */
export const returnStatusSchema = z.enum([
  'REQUESTED',
  'APPROVED',
  'ITEM_RECEIVED',
  'REFUND_PROCESSED',
  'CLOSED',
  'REJECTED',
]);
export type ReturnStatus = z.infer<typeof returnStatusSchema>;

/** Mirror of Prisma `enum ReturnReason`. */
export const returnReasonSchema = z.enum([
  'WRONG_SIZE',
  'DEFECTIVE',
  'NOT_AS_DESCRIBED',
  'CHANGED_MIND',
  'OTHER',
]);
export type ReturnReason = z.infer<typeof returnReasonSchema>;

/** Mirror of Prisma `enum RestockDecision`. */
export const restockDecisionSchema = z.enum(['RESTOCK', 'DAMAGED', 'DISPOSE']);
export type RestockDecision = z.infer<typeof restockDecisionSchema>;

/** Mirror of Prisma `enum ReturnRefundMethod`. */
export const returnRefundMethodSchema = z.enum(['ORIGINAL_PAYMENT', 'STORE_CREDIT', 'EXCHANGE']);
export type ReturnRefundMethod = z.infer<typeof returnRefundMethodSchema>;

const moneyStringSchema = z.union([z.string(), z.number()]).transform((v) => String(v));

const returnOrderRefSchema = z.object({
  id: entityIdSchema.optional(),
  orderNumber: z.string().optional(),
  status: z.string().optional(),
  currency: z.string().optional(),
  createdAt: z.string().datetime().optional(),
});

const returnCustomerRefSchema = z.object({
  id: entityIdSchema,
  email: z.string().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
});

export const returnItemSchema = z.object({
  id: entityIdSchema,
  returnId: entityIdSchema.optional(),
  orderItemId: entityIdSchema,
  variantId: entityIdSchema.nullable().optional(),
  exchangeVariantId: entityIdSchema.nullable().optional(),
  quantity: z.number().int().nonnegative(),
  restockDecision: restockDecisionSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  orderItem: z
    .object({
      id: entityIdSchema.optional(),
      sku: z.string().optional(),
      productName: z.union([z.string(), translatableSchema]).optional(),
      unitPrice: moneyStringSchema.optional(),
      quantity: z.number().int().optional(),
    })
    .optional(),
  variant: z
    .object({
      id: entityIdSchema.optional(),
      sku: z.string().optional(),
    })
    .optional(),
});
export type ReturnItem = z.infer<typeof returnItemSchema>;

/** List-row shape: everything the admin table needs, plus nested order + customer refs. */
export const returnSchema = z.object({
  id: entityIdSchema,
  returnNumber: z.string().optional(),
  orderId: entityIdSchema,
  customerId: entityIdSchema.nullable().optional(),
  status: returnStatusSchema,
  reason: returnReasonSchema.nullable().optional(),
  reasonDetail: z.string().nullable().optional(),
  refundMethod: returnRefundMethodSchema.nullable().optional(),
  refundAmount: moneyStringSchema.nullable().optional(),
  requestedAt: z.string().datetime().optional(),
  approvedAt: z.string().datetime().nullable().optional(),
  receivedAt: z.string().datetime().nullable().optional(),
  refundedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
  order: returnOrderRefSchema.optional(),
  customer: returnCustomerRefSchema.nullable().optional(),
  items: z.array(returnItemSchema).optional(),
});
export type Return = z.infer<typeof returnSchema>;

/** Detail shape: list row + admin notes + typed items + photos. */
export const returnDetailSchema = returnSchema.extend({
  adminNotes: z.string().nullable().optional(),
  items: z.array(returnItemSchema).optional(),
  photos: z.array(z.unknown()).optional(),
});
export type ReturnDetail = z.infer<typeof returnDetailSchema>;

export const listReturnsQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().optional(),
  status: returnStatusSchema.optional(),
  reason: returnReasonSchema.optional(),
  customerId: entityIdSchema.optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});
export type ListReturnsQuery = z.infer<typeof listReturnsQuerySchema>;

export const listReturnsResponseSchema = z.object({
  data: z.array(returnSchema),
  meta: paginationMetaSchema,
});
export type ListReturnsResponse = z.infer<typeof listReturnsResponseSchema>;

export const analyticsQuerySchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});
export type ReturnsAnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const returnsAnalyticsResponseSchema = z.object({
  totalReturns: z.number().nonnegative(),
  totalOrders: z.number().nonnegative(),
  returnRate: z.number(),
  byStatus: z.array(
    z.object({
      status: returnStatusSchema,
      count: z.number().nonnegative(),
    }),
  ),
  byReason: z.array(
    z.object({
      reason: returnReasonSchema,
      count: z.number().nonnegative(),
    }),
  ),
  refundsByMethod: z.array(
    z.object({
      method: returnRefundMethodSchema,
      count: z.number().nonnegative(),
    }),
  ),
  topReturnedVariants: z.array(
    z.object({
      variantId: entityIdSchema,
      totalQuantityReturned: z.number().nonnegative(),
    }),
  ),
});
export type ReturnsAnalytics = z.infer<typeof returnsAnalyticsResponseSchema>;

export const rejectReturnRequestSchema = z.object({
  reason: z.string().min(1).max(1000),
});
export type RejectReturnRequest = z.infer<typeof rejectReturnRequestSchema>;

export const receiveReturnRequestSchema = z.object({
  items: z
    .array(
      z.object({
        returnItemId: entityIdSchema,
        restockDecision: restockDecisionSchema,
        notes: z.string().max(500).optional(),
      }),
    )
    .nonempty(),
});
export type ReceiveReturnRequest = z.infer<typeof receiveReturnRequestSchema>;

export const refundReturnRequestSchema = z.object({
  refundMethod: returnRefundMethodSchema,
  notes: z.string().max(1000).optional(),
});
export type RefundReturnRequest = z.infer<typeof refundReturnRequestSchema>;
