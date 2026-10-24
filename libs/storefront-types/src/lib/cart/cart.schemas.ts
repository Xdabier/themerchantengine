import { z } from 'zod';
import { cartSchema, decimalSchema } from '../shared/entities';

/**
 * Storefront cart schemas. Mirrors:
 * - `apps/api/src/modules/cart/dto/add-item.dto.ts:AddItemDto`
 * - `apps/api/src/modules/cart/dto/update-item.dto.ts:UpdateItemDto`
 * - `apps/api/src/modules/cart/dto/apply-coupon.dto.ts:ApplyCouponDto`
 * - `apps/api/src/modules/cart/dto/apply-gift-card.dto.ts:ApplyGiftCardDto`
 * - `apps/api/src/modules/cart/dto/estimate-shipping.dto.ts:EstimateShippingDto`
 *
 * Cart routes are class-level `@OptionalAuth()` — anonymous carts identify via
 * the `sessionId` cookie set by the API on first POST.
 */

export const addItemRequestSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().min(1),
});
export type AddItemRequest = z.infer<typeof addItemRequestSchema>;

export const updateItemRequestSchema = z.object({
  quantity: z.number().int().min(1),
});
export type UpdateItemRequest = z.infer<typeof updateItemRequestSchema>;

export const applyCouponRequestSchema = z.object({
  code: z
    .string()
    .max(50)
    .regex(/^[A-Z0-9_-]+$/i, {
      message: 'code must contain only letters, digits, - or _',
    }),
});
export type ApplyCouponRequest = z.infer<typeof applyCouponRequestSchema>;

/**
 * Eight to twenty, matching the API.
 *
 * This used to require exactly sixteen, which is the length the generator
 * produces but not the range the API accepts: `ApplyGiftCardDto` and the admin
 * `CreateGiftCardDto` both allow 8-20, so an operator-issued short code was
 * rejected here before it ever reached the server, with a client-side message
 * naming a rule the server does not have.
 */
export const applyGiftCardRequestSchema = z.object({
  code: z.string().regex(/^[A-Z0-9]{8,20}$/, {
    message: 'code must be 8 to 20 uppercase alphanumeric characters',
  }),
});
export type ApplyGiftCardRequest = z.infer<typeof applyGiftCardRequestSchema>;

export const estimateShippingQuerySchema = z.object({
  country: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2 uppercase'),
  postalCode: z.string().min(3).max(10).optional(),
});
export type EstimateShippingQuery = z.infer<typeof estimateShippingQuerySchema>;

/**
 * One quote from `GET /v1/cart/estimate`.
 *
 * This disagreed with the API on all three of shape, field name and currency:
 * it declared `cost` where the API sends `price`, required a three-character
 * `currency` the API never sends, and was wrapped in a bare array where the
 * API returns `{ rates, taxEstimate }`. The mismatch was invisible because
 * `CartService.estimate` had no production caller and its spec supplied a
 * conforming fixture. Wiring the checkout to call it makes all three live.
 *
 * `name` is `unknown` rather than `string` because the API returns the
 * method's Translatable, which the locale interceptor narrows only on the
 * paths that declare a resolve header.
 */
export const shippingMethodQuoteSchema = z
  .object({
    methodId: z.string(),
    name: z.unknown(),
    price: decimalSchema,
    isDefault: z.boolean().optional(),
    estimatedDaysMin: z.number().nullable().optional(),
    estimatedDaysMax: z.number().nullable().optional(),
  })
  .passthrough();

export type ShippingMethodQuote = z.infer<typeof shippingMethodQuoteSchema>;

export const estimateShippingResponseSchema = z
  .object({
    rates: z.array(shippingMethodQuoteSchema).default([]),
    taxEstimate: decimalSchema.nullable().optional(),
  })
  .passthrough();

export type EstimateShippingResponse = z.infer<typeof estimateShippingResponseSchema>;

export { cartSchema };
export type { Cart, CartLine } from '../shared/entities';
