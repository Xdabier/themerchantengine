import { Inject, Injectable } from '@angular/core';
import {
  apiResponseSchema,
  categoryDetailSchema,
  listCategoriesResponseSchema,
  listCategoryProductsQuerySchema,
  listCategoryProductsResponseSchema,
  paginationMetaSchema,
  type Category,
  type ListCategoryProductsQuery,
  type PaginationMeta,
  type ProductSummary,
} from '@storefront-types';
import { z } from 'zod';
import { STOREFRONT_API_CLIENT, type ApiClient } from '../shared/api-client.token';

const paginatedCategoryProductsEnvelopeSchema = apiResponseSchema(
  listCategoryProductsResponseSchema,
).extend({ meta: paginationMetaSchema });

@Injectable({ providedIn: 'root' })
export class CategoriesService {
  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  async list(): Promise<Category[]> {
    const envelope = await this.api.get<unknown>('/v1/categories');
    return apiResponseSchema(listCategoriesResponseSchema).parse(envelope).data;
  }

  async getBySlug(slug: string): Promise<Category> {
    z.string().min(1).parse(slug);
    const envelope = await this.api.get<unknown>(`/v1/categories/${encodeURIComponent(slug)}`);
    return apiResponseSchema(categoryDetailSchema).parse(envelope).data;
  }

  async listProducts(
    slug: string,
    query: ListCategoryProductsQuery = {},
  ): Promise<{ data: ProductSummary[]; meta: PaginationMeta }> {
    z.string().min(1).parse(slug);
    const parsed = listCategoryProductsQuerySchema.parse(query);
    const envelope = await this.api.get<unknown>(
      `/v1/categories/${encodeURIComponent(slug)}/products`,
      { query: parsed as Record<string, number | undefined> },
    );
    const result = paginatedCategoryProductsEnvelopeSchema.parse(envelope);
    return { data: result.data, meta: result.meta };
  }
}
