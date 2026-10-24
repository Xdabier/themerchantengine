import { z } from 'zod';
import { entityIdSchema, paginationMetaSchema, translatableSchema } from '@admin-types';

/** Prisma.Decimal columns serialise as strings — coerce to number. */
const coercedMoney = z.union([z.number(), z.string().transform((s) => Number(s))]);

export const giftCardTransactionSchema = z.object({
  id: entityIdSchema,
  amount: coercedMoney,
  // Backend's GiftCardTransaction stores `note` (the human-readable ledger
  // label, e.g. "Initial load" / "Order redemption") and an optional `orderId`
  // reference. The legacy `kind` field was never populated by the live API —
  // binding it left every ledger row blank — so it is removed; render `note`.
  note: z.string().nullable().optional(),
  orderId: entityIdSchema.nullable().optional(),
  referenceId: z.string().nullable().optional(),
  giftCardId: entityIdSchema.optional(),
  createdAt: z.string().datetime(),
});

export const giftCardSchema = z.object({
  id: entityIdSchema,
  code: z.string(),
  initialBalance: coercedMoney,
  currentBalance: coercedMoney,
  currency: z.string().length(3),
  recipientEmail: z.string().email().nullable().optional(),
  recipientName: z.string().nullable().optional(),
  personalMessage: translatableSchema.nullable().optional(),
  purchasedBy: entityIdSchema.nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  transactions: z.array(giftCardTransactionSchema).optional(),
});
export type GiftCard = z.infer<typeof giftCardSchema>;
export type GiftCardTransaction = z.infer<typeof giftCardTransactionSchema>;

export const listGiftCardsQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().optional(),
  recipientEmail: z.string().email().optional(),
  purchasedBy: z.string().optional(),
  isActive: z.boolean().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});
export type ListGiftCardsQuery = z.infer<typeof listGiftCardsQuerySchema>;

export const listGiftCardsResponseSchema = z.object({
  data: z.array(giftCardSchema),
  meta: paginationMetaSchema,
});
export type ListGiftCardsResponse = z.infer<typeof listGiftCardsResponseSchema>;

export const createGiftCardRequestSchema = z.object({
  initialBalance: z.number().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 currency code'),
  code: z
    .string()
    .regex(/^[A-Z0-9]{8,20}$/)
    .optional(),
  recipientEmail: z.string().email().optional(),
  recipientName: z.string().max(100).optional(),
  personalMessage: translatableSchema.optional(),
  purchasedBy: entityIdSchema.optional(),
  expiresAt: z.string().datetime().optional(),
  isActive: z.boolean().optional(),
});
export type CreateGiftCardRequest = z.infer<typeof createGiftCardRequestSchema>;

export const updateGiftCardRequestSchema = z.object({
  isActive: z.boolean().optional(),
});
export type UpdateGiftCardRequest = z.infer<typeof updateGiftCardRequestSchema>;

export const adjustGiftCardBalanceRequestSchema = z.object({
  amount: z.number().refine((n) => n !== 0, { message: 'amount must be non-zero' }),
  reason: z.string().min(3).max(500),
  referenceId: z.string().max(128).optional(),
});
export type AdjustGiftCardBalanceRequest = z.infer<typeof adjustGiftCardBalanceRequestSchema>;

export const resendGiftCardEmailResponseSchema = z.object({
  status: z.literal('queued'),
  recipientEmail: z.string().email(),
});
export type ResendGiftCardEmailResponse = z.infer<typeof resendGiftCardEmailResponseSchema>;
