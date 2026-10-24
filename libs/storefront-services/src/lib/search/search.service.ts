import { Inject, Injectable } from '@angular/core';
import {
  apiResponseSchema,
  filtersQuerySchema,
  filtersResponseSchema,
  logClickRequestSchema,
  paginationMetaSchema,
  searchProductsQuerySchema,
  searchResultsResponseSchema,
  suggestQuerySchema,
  suggestResponseSchema,
  type FiltersQuery,
  type LogClickRequest,
  type PaginationMeta,
  type SearchHit,
  type SearchProductsQuery,
  type SuggestQuery,
} from '@storefront-types';
import * as z from 'zod';
import { STOREFRONT_API_CLIENT, type ApiClient } from '../shared/api-client.token';

const paginatedSearchEnvelopeSchema = apiResponseSchema(searchResultsResponseSchema).extend({
  meta: paginationMetaSchema,
});

@Injectable({ providedIn: 'root' })
export class SearchService {
  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  async search(
    query: SearchProductsQuery = {},
  ): Promise<{ data: SearchHit[]; meta: PaginationMeta }> {
    const parsed = searchProductsQuerySchema.parse(query);
    const envelope = await this.api.get<unknown>('/v1/search', {
      query: parsed as Record<string, string | number | boolean | undefined>,
    });
    const result = paginatedSearchEnvelopeSchema.parse(envelope);
    return { data: result.data, meta: result.meta };
  }

  async suggest(query: SuggestQuery): Promise<z.infer<typeof suggestResponseSchema>> {
    const parsed = suggestQuerySchema.parse(query);
    const envelope = await this.api.get<unknown>('/v1/search/suggest', { query: parsed });
    return apiResponseSchema(suggestResponseSchema).parse(envelope).data;
  }

  async filters(query: FiltersQuery = {}): Promise<z.infer<typeof filtersResponseSchema>> {
    const parsed = filtersQuerySchema.parse(query);
    const envelope = await this.api.get<unknown>('/v1/search/filters', { query: parsed });
    return apiResponseSchema(filtersResponseSchema).parse(envelope).data;
  }

  async logClick(eventId: string, body: LogClickRequest): Promise<void> {
    z.string().min(1).parse(eventId);
    const parsed = logClickRequestSchema.parse(body);
    // The result card is a plain link: the click unloads the page, and WebKit
    // aborts any fetch still in flight unless it is a keepalive request.
    await this.api.post<unknown>(`/v1/search/events/${encodeURIComponent(eventId)}/click`, parsed, {
      keepalive: true,
    });
  }

  /**
   * Log a search-driven conversion. The S10 checkout completion path is the
   * only caller — for every cart item that landed via a search-event id the
   * order-confirmation page calls this once with that event id. The POST is
   * fire-and-forget on the storefront side; the API persists the conversion
   * link so analytics can attribute orders back to search queries.
   *
   * Wiring notes for S10:
   * - cart items must carry the `searchEventId` field threaded from S7's
   *   click payload,
   * - the confirmation page should call `logConversion` per unique event id
   *   (deduplicate before iterating to avoid double-counting),
   * - failures must not block the order-confirmation render — log to the
   *   dev console only.
   */
  async logConversion(eventId: string): Promise<void> {
    z.string().min(1).parse(eventId);
    await this.api.post<unknown>(`/v1/search/events/${encodeURIComponent(eventId)}/convert`);
  }
}
