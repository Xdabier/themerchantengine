import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { paginationMetaSchema } from '@admin-types';
import { ADMIN_API_BASE_URL, envelope, rawLocaleContext, toParams } from '../shared';
import {
  adjustInventoryRequestSchema,
  type AdjustInventoryRequest,
  createLocationRequestSchema,
  type CreateLocationRequest,
  inventoryAlertSchema,
  type InventoryAlert,
  type InventoryLocation,
  type ListLocationsResponse,
  type ListMovementsQuery,
  listMovementsQuerySchema,
  listMovementsResponseSchema,
  type ListMovementsResponse,
  type ListStockLevelsQuery,
  listStockLevelsQuerySchema,
  listStockLevelsResponseSchema,
  type ListStockLevelsResponse,
  listLocationsResponseSchema,
  locationSchema,
  paginationQuerySchema,
  type PaginationQuery,
  transferInventoryRequestSchema,
  type TransferInventoryRequest,
  updateLocationRequestSchema,
  type UpdateLocationRequest,
  variantStockDetailSchema,
  type VariantStockDetail,
} from './inventory.schemas';

const INVENTORY = ADMIN_API_ROUTES.inventory;

export type ListAlertsResponse = {
  data: InventoryAlert[];
  meta: { page: number; pageSize: number; total: number; totalPages?: number };
};

/** `/v1/admin/inventory/*`. */
@Injectable({ providedIn: 'root' })
export class InventoryService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  listStockLevels(query: ListStockLevelsQuery = {}): Observable<ListStockLevelsResponse> {
    const parsed = listStockLevelsQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(INVENTORY.base, INVENTORY.list)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listStockLevelsResponseSchema.parse(raw)));
  }

  /**
   * GET /admin/inventory/variant/:variantId — per-location stock plus the
   * variant's identity.
   *
   * The response carries the variant even when it has no stock rows, which is
   * the case the previous bare-array shape could not express.
   */
  getVariantStock(variantId: string): Observable<VariantStockDetail> {
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(INVENTORY.base, fillRoute(INVENTORY.variant, { variantId }))}`,
        { context: rawLocaleContext(), withCredentials: true },
      )
      .pipe(map((raw) => variantStockDetailSchema.parse(envelope(raw))));
  }

  /**
   * PATCH /adjust — backend returns `void`; surface `Observable<void>`.
   *
   * Stock mutations require `X-Idempotency-Key` (constitution §3.6). Without it
   * the endpoint 400s, which is what made the Adjust dialog impossible to submit
   * from the dashboard.
   *
   * The caller MAY pass the key. It should, and should reuse the same one across
   * retries of one intent, because that is the only thing that makes a retry a
   * replay. Minting one here per call is the fallback, and it is deliberately
   * documented as weak: two clicks produce two different keys, so the server
   * sees two distinct requests and applies both. The comment that used to sit
   * here claimed the opposite.
   */
  adjustInventory(input: AdjustInventoryRequest, idempotencyKey?: string): Observable<void> {
    const body = adjustInventoryRequestSchema.parse(input);
    return this.http
      .patch<unknown>(`${this.apiBase}/${adminRoute(INVENTORY.base, INVENTORY.adjust)}`, body, {
        headers: { 'X-Idempotency-Key': idempotencyKey ?? crypto.randomUUID() },
        withCredentials: true,
      })
      .pipe(map(() => undefined));
  }

  /** POST /transfer — backend returns `void`. Same idempotency contract, and
   * the same caveat: pass a key and reuse it across retries of one intent. */
  transferInventory(input: TransferInventoryRequest, idempotencyKey?: string): Observable<void> {
    const body = transferInventoryRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(INVENTORY.base, INVENTORY.transfer)}`, body, {
        headers: { 'X-Idempotency-Key': idempotencyKey ?? crypto.randomUUID() },
        withCredentials: true,
      })
      .pipe(map(() => undefined));
  }

  listAlerts(query: PaginationQuery = {}): Observable<ListAlertsResponse> {
    const parsed = paginationQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(INVENTORY.base, INVENTORY.alerts)}`, {
        params,
        withCredentials: true,
      })
      .pipe(
        map((raw) => {
          const body = raw as { data?: unknown; meta?: unknown };
          const data = Array.isArray(body?.data)
            ? body.data.map((row) => inventoryAlertSchema.parse(row))
            : [];
          const meta = paginationMetaSchema.parse(
            body?.meta ?? { page: 1, pageSize: 20, total: 0 },
          );
          return { data, meta };
        }),
      );
  }

  listMovements(query: ListMovementsQuery = {}): Observable<ListMovementsResponse> {
    const parsed = listMovementsQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(INVENTORY.base, INVENTORY.movements)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listMovementsResponseSchema.parse(raw)));
  }

  listLocations(query: PaginationQuery = {}): Observable<ListLocationsResponse> {
    const parsed = paginationQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(INVENTORY.base, INVENTORY.locations)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listLocationsResponseSchema.parse(raw)));
  }

  createLocation(input: CreateLocationRequest): Observable<InventoryLocation> {
    const body = createLocationRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(INVENTORY.base, INVENTORY.locations)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => locationSchema.parse(envelope(raw))));
  }

  updateLocation(id: string, input: UpdateLocationRequest): Observable<InventoryLocation> {
    const body = updateLocationRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(INVENTORY.base, fillRoute(INVENTORY.locationById, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => locationSchema.parse(envelope(raw))));
  }

  deleteLocation(id: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiBase}/${adminRoute(INVENTORY.base, fillRoute(INVENTORY.locationById, { id }))}`,
        {
          withCredentials: true,
        },
      )
      .pipe(map(() => undefined));
  }
}
