import { Inject, Injectable } from '@angular/core';
import {
  apiResponseSchema,
  brandFacetListSchema,
  listProductsQuerySchema,
  paginationMetaSchema,
  productDetailSchema,
  productSummaryListSchema,
  type BrandFacet,
  type ListProductsQuery,
  type PaginationMeta,
  type ProductDetail,
  type ProductSummary,
} from '@storefront-types';
import { z } from 'zod';
import { STOREFRONT_API_CLIENT, type ApiClient } from '../shared/api-client.token';

const paginatedSummariesEnvelopeSchema = apiResponseSchema(productSummaryListSchema).extend({
  meta: paginationMetaSchema,
});

/** One filterable specification group, as the API derived it. */
export interface CatalogSpecFacetDto {
  key: string;
  label: string;
  coverage: number;
  values: { valueKey: string; value: string; count: number }[];
}

@Injectable({ providedIn: 'root' })
export class ProductsService {
  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  /**
   * Filterable specification facets, derived by the API from the live catalogue.
   *
   * Deliberately unparsed beyond a shape cast: the facet set is data, not a
   * contract, and it changes whenever an operator adds a specification. A strict
   * schema here would turn "the catalogue grew a new filter" into a parse error.
   */
  async specFacets(): Promise<CatalogSpecFacetDto[]> {
    const envelope = await this.api.get<unknown>('/v1/products/spec-facets');
    const data = (envelope as { data?: unknown } | null)?.data;
    return Array.isArray(data) ? (data as CatalogSpecFacetDto[]) : [];
  }

  /**
   * Brand facets for the catalogue rail, over the whole ACTIVE catalogue and
   * optionally scoped to a category.
   *
   * The rail used to compute its brand list from the products on screen, which
   * is a page-1 sample of the already-filtered result, so choosing a brand
   * collapsed the facet to that brand (finding C11).
   *
   * Secondary content: a failed or malformed response degrades to no brands,
   * because losing the rail must never cost the catalogue its grid.
   */
  async brandFacets(categoryId?: string): Promise<BrandFacet[]> {
    try {
      const envelope = await this.api.get<unknown>('/v1/products/brands', {
        query: categoryId ? { categoryId } : {},
      });
      const data = (envelope as { data?: unknown } | null)?.data;
      const parsed = brandFacetListSchema.safeParse(data);
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  }

  async list(
    query: ListProductsQuery = {},
  ): Promise<{ data: ProductSummary[]; meta: PaginationMeta }> {
    const parsed = listProductsQuerySchema.parse(query);
    const envelope = await this.api.get<unknown>('/v1/products', {
      query: parsed as Record<string, string | number | boolean | undefined>,
    });
    const result = paginatedSummariesEnvelopeSchema.parse(envelope);
    return { data: result.data, meta: result.meta };
  }

  async getBySlug(slug: string): Promise<ProductDetail> {
    z.string().min(1).parse(slug);
    const envelope = await this.api.get<unknown>(`/v1/products/${encodeURIComponent(slug)}`);
    return apiResponseSchema(productDetailSchema).parse(envelope).data;
  }
}
