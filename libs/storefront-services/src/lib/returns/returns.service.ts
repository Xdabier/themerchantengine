import { Inject, Injectable } from '@angular/core';
import {
  apiResponseSchema,
  createReturnRequestSchema,
  listReturnsQuerySchema,
  paginationMetaSchema,
  returnSchema,
  type CreateReturnRequest,
  type ListReturnsQuery,
  type PaginationMeta,
  type Return,
} from '@storefront-types';
import * as z from 'zod';
import { STOREFRONT_API_CLIENT, type ApiClient } from '../shared/api-client.token';

const paginatedReturnsEnvelopeSchema = apiResponseSchema(z.array(returnSchema)).extend({
  meta: paginationMetaSchema,
});

@Injectable({ providedIn: 'root' })
export class ReturnsService {
  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  async create(orderId: string, input: CreateReturnRequest): Promise<Return> {
    z.string().min(1).parse(orderId);
    const body = createReturnRequestSchema.parse(input);
    const envelope = await this.api.post<unknown>(
      `/v1/orders/${encodeURIComponent(orderId)}/returns`,
      body,
    );
    return apiResponseSchema(returnSchema).parse(envelope).data;
  }

  async list(query: ListReturnsQuery = {}): Promise<{ data: Return[]; meta: PaginationMeta }> {
    const parsed = listReturnsQuerySchema.parse(query);
    const envelope = await this.api.get<unknown>('/v1/returns', {
      query: parsed as Record<string, number | undefined>,
    });
    const result = paginatedReturnsEnvelopeSchema.parse(envelope);
    return { data: result.data, meta: result.meta };
  }

  async getById(id: string): Promise<Return> {
    z.string().min(1).parse(id);
    const envelope = await this.api.get<unknown>(`/v1/returns/${encodeURIComponent(id)}`);
    return apiResponseSchema(returnSchema).parse(envelope).data;
  }
}
