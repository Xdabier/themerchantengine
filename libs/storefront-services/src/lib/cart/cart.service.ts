import { Inject, Injectable, signal, type Signal } from '@angular/core';
import {
  addItemRequestSchema,
  apiResponseSchema,
  applyCouponRequestSchema,
  applyGiftCardRequestSchema,
  cartSchema,
  estimateShippingQuerySchema,
  estimateShippingResponseSchema,
  type AddItemRequest,
  type ApplyCouponRequest,
  type ApplyGiftCardRequest,
  type Cart,
  type EstimateShippingQuery,
  type UpdateItemRequest,
  updateItemRequestSchema,
} from '@storefront-types';
import * as z from 'zod';
import { STOREFRONT_API_CLIENT, type ApiClient } from '../shared/api-client.token';

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly _itemCount = signal(0);
  /**
   * Total quantity across all live cart items. Read by Header + MobileBottomNav
   * to drive the cart-icon badge. Updated on every successful mutation.
   *
   * Seeded at 0 — first paint shows 0 until `get()` (or any mutation) refreshes
   * it. SSR initial paint is intentionally zero; the layout shell triggers a
   * client-side refresh during hydration.
   */
  readonly itemCount: Signal<number> = this._itemCount.asReadonly();

  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  async get(): Promise<Cart> {
    const envelope = await this.api.get<unknown>('/v1/cart');
    const cart = apiResponseSchema(cartSchema).parse(envelope).data;
    this.syncItemCount(cart);
    return cart;
  }

  async addItem(input: AddItemRequest): Promise<Cart> {
    const body = addItemRequestSchema.parse(input);
    const envelope = await this.api.post<unknown>('/v1/cart/items', body);
    const cart = apiResponseSchema(cartSchema).parse(envelope).data;
    this.syncItemCount(cart);
    return cart;
  }

  async updateItem(itemId: string, input: UpdateItemRequest): Promise<Cart> {
    z.string().min(1).parse(itemId);
    const body = updateItemRequestSchema.parse(input);
    const envelope = await this.api.patch<unknown>(
      `/v1/cart/items/${encodeURIComponent(itemId)}`,
      body,
    );
    const cart = apiResponseSchema(cartSchema).parse(envelope).data;
    this.syncItemCount(cart);
    return cart;
  }

  async removeItem(itemId: string): Promise<Cart> {
    z.string().min(1).parse(itemId);
    const envelope = await this.api.delete<unknown>(`/v1/cart/items/${encodeURIComponent(itemId)}`);
    const cart = apiResponseSchema(cartSchema).parse(envelope).data;
    this.syncItemCount(cart);
    return cart;
  }

  async clear(): Promise<void> {
    await this.api.delete<unknown>('/v1/cart');
    this._itemCount.set(0);
  }

  async applyCoupon(input: ApplyCouponRequest): Promise<Cart> {
    const body = applyCouponRequestSchema.parse(input);
    const envelope = await this.api.post<unknown>('/v1/cart/coupon', body);
    const cart = apiResponseSchema(cartSchema).parse(envelope).data;
    this.syncItemCount(cart);
    return cart;
  }

  async removeCoupon(): Promise<Cart> {
    const envelope = await this.api.delete<unknown>('/v1/cart/coupon');
    const cart = apiResponseSchema(cartSchema).parse(envelope).data;
    this.syncItemCount(cart);
    return cart;
  }

  async applyGiftCard(input: ApplyGiftCardRequest): Promise<Cart> {
    const body = applyGiftCardRequestSchema.parse(input);
    const envelope = await this.api.post<unknown>('/v1/cart/gift-card', body);
    const cart = apiResponseSchema(cartSchema).parse(envelope).data;
    this.syncItemCount(cart);
    return cart;
  }

  async removeGiftCard(): Promise<void> {
    await this.api.delete<unknown>('/v1/cart/gift-card');
  }

  async estimate(
    query: EstimateShippingQuery,
  ): Promise<z.infer<typeof estimateShippingResponseSchema>> {
    const parsed = estimateShippingQuerySchema.parse(query);
    const envelope = await this.api.get<unknown>('/v1/cart/estimate', { query: parsed });
    return apiResponseSchema(estimateShippingResponseSchema).parse(envelope).data;
  }

  /**
   * Fold the anonymous cart into the signed-in customer's cart.
   *
   * Called on every auth transition. The session id lives in an `HttpOnly`
   * cookie the browser will not show us, so there is nothing to pass: the
   * server reads it. Cheap when there is nothing to merge, and it answers with
   * the resulting cart so the badge lands in the same round trip.
   *
   * Rejections are surfaced rather than swallowed here. The two callers both
   * ignore them, but that is their policy to state at the call site, not this
   * method's to hide.
   */
  async merge(): Promise<Cart> {
    const envelope = await this.api.post<unknown>('/v1/cart/merge');
    const cart = apiResponseSchema(cartSchema).parse(envelope).data;
    this.syncItemCount(cart);
    return cart;
  }

  async saveForLater(itemId: string): Promise<Cart> {
    z.string().min(1).parse(itemId);
    const envelope = await this.api.post<unknown>(
      `/v1/cart/items/${encodeURIComponent(itemId)}/save-for-later`,
    );
    const cart = apiResponseSchema(cartSchema).parse(envelope).data;
    this.syncItemCount(cart);
    return cart;
  }

  private syncItemCount(cart: Cart): void {
    const total = cart.items.reduce((acc, line) => acc + line.quantity, 0);
    this._itemCount.set(total);
  }
}
