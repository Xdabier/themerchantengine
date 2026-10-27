import { Inject, Injectable } from '@angular/core';
import {
  apiResponseSchema,
  listWishlistQuerySchema,
  paginationMetaSchema,
  wishlistIdsSchema,
  wishlistItemSchema,
  type ListWishlistQuery,
  type PaginationMeta,
  type WishlistItem,
} from '@storefront-types';
import * as z from 'zod';
import { STOREFRONT_API_CLIENT, type ApiClient } from '../shared/api-client.token';

const paginatedWishlistEnvelopeSchema = apiResponseSchema(z.array(wishlistItemSchema)).extend({
  meta: paginationMetaSchema,
});

@Injectable({ providedIn: 'root' })
export class WishlistService {
  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  async list(
    query: ListWishlistQuery = {},
  ): Promise<{ data: WishlistItem[]; meta: PaginationMeta }> {
    const parsed = listWishlistQuerySchema.parse(query);
    const envelope = await this.api.get<unknown>('/v1/wishlist', {
      query: parsed as Record<string, string | number | undefined>,
    });
    const result = paginatedWishlistEnvelopeSchema.parse(envelope);
    return { data: result.data, meta: result.meta };
  }

  /**
   * The productIds this customer has wishlisted, newest first. One call per
   * session hydrates every heart on every page; `list()` is the wrong source
   * for that (see `wishlistIdsSchema`).
   */
  async ids(): Promise<string[]> {
    const envelope = await this.api.get<unknown>('/v1/wishlist/ids');
    return apiResponseSchema(wishlistIdsSchema).parse(envelope).data.productIds;
  }

  async add(productId: string): Promise<WishlistItem> {
    z.string().min(1).parse(productId);
    const envelope = await this.api.post<unknown>(`/v1/wishlist/${encodeURIComponent(productId)}`);
    return apiResponseSchema(wishlistItemSchema).parse(envelope).data;
  }

  async remove(productId: string): Promise<void> {
    z.string().min(1).parse(productId);
    await this.api.delete<unknown>(`/v1/wishlist/${encodeURIComponent(productId)}`);
  }
}
