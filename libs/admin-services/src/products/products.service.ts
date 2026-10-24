import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { z } from 'zod';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { paginationMetaSchema, type PaginationMeta } from '@admin-types';
import { ADMIN_API_BASE_URL, envelope, rawLocaleContext, toParams } from '../shared';
import { productStockSchema, type ProductStock } from '../inventory/inventory.schemas';
import {
  attributeSchema,
  type Attribute,
  bulkUpdatePricesRequestSchema,
  type BulkUpdatePricesRequest,
  bulkUpdateStatusRequestSchema,
  type BulkUpdateStatusRequest,
  createAttributeRequestSchema,
  type CreateAttributeRequest,
  createAttributeValueRequestSchema,
  type CreateAttributeValueRequest,
  createProductFaqRequestSchema,
  type CreateProductFaqRequest,
  createProductRequestSchema,
  type CreateProductRequest,
  createProductTypeRequestSchema,
  type CreateProductTypeRequest,
  createVariantRequestSchema,
  type CreateVariantRequest,
  type ListAttributesQuery,
  listAttributesQuerySchema,
  type ListPaginationQuery,
  listPaginationQuerySchema,
  type ListProductsQuery,
  listProductsQuerySchema,
  type ListProductsResponse,
  listProductsResponseSchema,
  type Product,
  productFaqSchema,
  type ProductFaq,
  productSchema,
  productTypeSchema,
  type ProductType,
  updateAttributeRequestSchema,
  type UpdateAttributeRequest,
  updateAttributeValueRequestSchema,
  type UpdateAttributeValueRequest,
  updateProductAssetsRequestSchema,
  type UpdateProductAssetsRequest,
  updateProductFaqRequestSchema,
  type UpdateProductFaqRequest,
  updateProductRequestSchema,
  type UpdateProductRequest,
  updateProductTypeRequestSchema,
  type UpdateProductTypeRequest,
  updateVariantRequestSchema,
  type UpdateVariantRequest,
  variantSchema,
  type Variant,
  productSpecSchema,
  replaceProductSpecsRequestSchema,
  listSpecLabelsQuerySchema,
  listSpecLabelsResponseSchema,
  type ProductSpec,
  type ReplaceProductSpecsRequest,
  type ListSpecLabelsQuery,
  type ListSpecLabelsResponse,
} from './products.schemas';

const PRODUCTS = ADMIN_API_ROUTES.products;

/**
 * Catalog surface: product types, attributes, attribute values, bulk ops,
 * products, variants, product asset assignments, product FAQs.
 *
 * Backing controller: `apps/api/src/modules/products/products.controller.ts`.
 * All routes under `/v1/admin/...`. Soft-delete + restore supported on products.
 */
@Injectable({ providedIn: 'root' })
export class ProductsService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  /* ── Product types ──────────────────────── */

  listProductTypes(
    query: ListPaginationQuery = {},
  ): Observable<{ data: ProductType[]; meta: PaginationMeta }> {
    const parsed = listPaginationQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(PRODUCTS.base, PRODUCTS.productTypes)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => this.paginatedOf(raw, productTypeSchema)));
  }

  createProductType(input: CreateProductTypeRequest): Observable<ProductType> {
    const body = createProductTypeRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(PRODUCTS.base, PRODUCTS.productTypes)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => productTypeSchema.parse(envelope(raw))));
  }

  updateProductType(id: string, input: UpdateProductTypeRequest): Observable<ProductType> {
    const body = updateProductTypeRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.productTypeById, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => productTypeSchema.parse(envelope(raw))));
  }

  deleteProductType(id: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.productTypeById, { id }))}`,
        { withCredentials: true },
      )
      .pipe(map(() => undefined));
  }

  /* ── Attributes ─────────────────────────── */

  listAttributes(
    query: ListAttributesQuery = {},
  ): Observable<{ data: Attribute[]; meta: PaginationMeta }> {
    const parsed = listAttributesQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(PRODUCTS.base, PRODUCTS.attributes)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => this.paginatedOf(raw, attributeSchema)));
  }

  createAttribute(input: CreateAttributeRequest): Observable<Attribute> {
    const body = createAttributeRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(PRODUCTS.base, PRODUCTS.attributes)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => attributeSchema.parse(envelope(raw))));
  }

  updateAttribute(id: string, input: UpdateAttributeRequest): Observable<Attribute> {
    const body = updateAttributeRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.attributeById, { id }))}`,
        body,
        { withCredentials: true },
      )
      .pipe(map((raw) => attributeSchema.parse(envelope(raw))));
  }

  deleteAttribute(id: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.attributeById, { id }))}`,
        { withCredentials: true },
      )
      .pipe(map(() => undefined));
  }

  createAttributeValue(
    attributeId: string,
    input: CreateAttributeValueRequest,
  ): Observable<Attribute> {
    const body = createAttributeValueRequestSchema.parse(input);
    return this.http
      .post<unknown>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.attributeValues, { id: attributeId }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => attributeSchema.parse(envelope(raw))));
  }

  updateAttributeValue(
    attributeId: string,
    valueId: string,
    input: UpdateAttributeValueRequest,
  ): Observable<Attribute> {
    const body = updateAttributeValueRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.attributeValueById, { id: attributeId, valueId }))}`,
        body,
        { withCredentials: true },
      )
      .pipe(map((raw) => attributeSchema.parse(envelope(raw))));
  }

  deleteAttributeValue(attributeId: string, valueId: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.attributeValueById, { id: attributeId, valueId }))}`,
        {
          withCredentials: true,
        },
      )
      .pipe(map(() => undefined));
  }

  /* ── Bulk ops ───────────────────────────── */

  bulkUpdatePrices(input: BulkUpdatePricesRequest): Observable<void> {
    const body = bulkUpdatePricesRequestSchema.parse(input);
    return this.http
      .patch<void>(`${this.apiBase}/${adminRoute(PRODUCTS.base, PRODUCTS.bulkPrices)}`, body, {
        withCredentials: true,
      })
      .pipe(map(() => undefined));
  }

  bulkUpdateStatus(input: BulkUpdateStatusRequest): Observable<void> {
    const body = bulkUpdateStatusRequestSchema.parse(input);
    return this.http
      .patch<void>(`${this.apiBase}/${adminRoute(PRODUCTS.base, PRODUCTS.bulkStatus)}`, body, {
        withCredentials: true,
      })
      .pipe(map(() => undefined));
  }

  /* ── Products ───────────────────────────── */

  listProducts(query: ListProductsQuery = {}): Observable<ListProductsResponse> {
    const parsed = listProductsQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(PRODUCTS.base, PRODUCTS.list)}`, {
        params,
        context: rawLocaleContext(),
        withCredentials: true,
      })
      .pipe(map((raw) => listProductsResponseSchema.parse(raw)));
  }

  createProduct(input: CreateProductRequest): Observable<Product> {
    const body = createProductRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(PRODUCTS.base, PRODUCTS.list)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => productSchema.parse(envelope(raw))));
  }

  getProduct(id: string): Observable<Product> {
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.byId, { id }))}`,
        {
          context: rawLocaleContext(),
          withCredentials: true,
        },
      )
      .pipe(map((raw) => productSchema.parse(envelope(raw))));
  }

  updateProduct(id: string, input: UpdateProductRequest): Observable<Product> {
    const body = updateProductRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.byId, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => productSchema.parse(envelope(raw))));
  }

  /** Soft-delete: status → ARCHIVED, deletedAt = now. */
  deleteProduct(id: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.byId, { id }))}`,
        { withCredentials: true },
      )
      .pipe(map(() => undefined));
  }

  restoreProduct(id: string): Observable<Product> {
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.restore, { id }))}`,
        {},
        { withCredentials: true },
      )
      .pipe(map((raw) => productSchema.parse(envelope(raw))));
  }

  /* ── Variants ───────────────────────────── */

  createVariant(productId: string, input: CreateVariantRequest): Observable<Variant> {
    const body = createVariantRequestSchema.parse(input);
    return this.http
      .post<unknown>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.variants, { id: productId }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => variantSchema.parse(envelope(raw))));
  }

  updateVariant(
    productId: string,
    variantId: string,
    input: UpdateVariantRequest,
  ): Observable<Variant> {
    const body = updateVariantRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.variantById, { id: productId, variantId }))}`,
        body,
        { withCredentials: true },
      )
      .pipe(map((raw) => variantSchema.parse(envelope(raw))));
  }

  deleteVariant(productId: string, variantId: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.variantById, { id: productId, variantId }))}`,
        {
          withCredentials: true,
        },
      )
      .pipe(map(() => undefined));
  }

  /* ── Assets + FAQs ──────────────────────── */

  updateProductAssets(productId: string, input: UpdateProductAssetsRequest): Observable<void> {
    const body = updateProductAssetsRequestSchema.parse(input);
    return this.http
      .patch<void>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.assets, { id: productId }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map(() => undefined));
  }

  /**
   * GET /admin/products/:id/stock — stock for every variant of one product.
   *
   * Gated on `inventory:view`, not `products:view`, so a caller without the
   * inventory permission gets a 403 here rather than a partly-rendered screen.
   * The page omits the call entirely in that case.
   */
  getProductStock(productId: string): Observable<ProductStock> {
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.stock, { id: productId }))}`,
        { withCredentials: true },
      )
      .pipe(map((raw) => productStockSchema.parse(envelope(raw))));
  }

  /**
   * PUT /admin/products/:id/specs — replace the whole specification set.
   *
   * The request is parsed before it leaves, so an over-cap array or a label
   * with no `default` fails here rather than as a 400 round trip. That parse
   * throws SYNCHRONOUSLY, so callers must wrap the call itself in try/catch
   * and not rely on the error channel alone.
   */
  replaceSpecs(productId: string, input: ReplaceProductSpecsRequest): Observable<ProductSpec[]> {
    const body = replaceProductSpecsRequestSchema.parse(input);
    return this.http
      .put<unknown>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.specs, { id: productId }))}`,
        body,
        { context: rawLocaleContext(), withCredentials: true },
      )
      .pipe(map((raw) => z.array(productSpecSchema).parse(envelope(raw))));
  }

  /**
   * GET /admin/product-specs/labels — distinct spec labels across the
   * catalogue, for the editor's label autocomplete.
   *
   * Sends `X-Resolve-Locale: false` like every other admin read, so `label`
   * arrives as the raw Translatable and the picker can fill a second locale
   * column from the same option.
   */
  listSpecLabels(query: ListSpecLabelsQuery = {}): Observable<ListSpecLabelsResponse> {
    const parsed = listSpecLabelsQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(PRODUCTS.base, PRODUCTS.specLabels)}`, {
        params,
        context: rawLocaleContext(),
        withCredentials: true,
      })
      .pipe(map((raw) => listSpecLabelsResponseSchema.parse(raw)));
  }

  createFaq(productId: string, input: CreateProductFaqRequest): Observable<ProductFaq> {
    const body = createProductFaqRequestSchema.parse(input);
    return this.http
      .post<unknown>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.faqs, { id: productId }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => productFaqSchema.parse(envelope(raw))));
  }

  updateFaq(
    productId: string,
    faqId: string,
    input: UpdateProductFaqRequest,
  ): Observable<ProductFaq> {
    const body = updateProductFaqRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.faqById, { id: productId, faqId }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => productFaqSchema.parse(envelope(raw))));
  }

  deleteFaq(productId: string, faqId: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiBase}/${adminRoute(PRODUCTS.base, fillRoute(PRODUCTS.faqById, { id: productId, faqId }))}`,
        {
          withCredentials: true,
        },
      )
      .pipe(map(() => undefined));
  }

  /* ── Helpers ────────────────────────────── */

  private paginatedOf<TSchema extends import('zod').ZodTypeAny>(
    raw: unknown,
    schema: TSchema,
  ): { data: Array<import('zod').infer<TSchema>>; meta: PaginationMeta } {
    const r = raw as { data: unknown[]; meta: unknown };
    const meta = paginationMetaSchema.parse(r.meta);
    const data = r.data.map((d) => schema.parse(d)) as Array<import('zod').infer<TSchema>>;
    return { data, meta };
  }
}
