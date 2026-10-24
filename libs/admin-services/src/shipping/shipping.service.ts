import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope, toParams } from '../shared';
import {
  createShippingMethodRequestSchema,
  type CreateShippingMethodRequest,
  createShippingZoneRequestSchema,
  type CreateShippingZoneRequest,
  listMethodsQuerySchema,
  type ListMethodsQuery,
  listMethodsResponseSchema,
  type ListMethodsResponse,
  listPaginatedQuerySchema,
  type ListPaginatedQuery,
  listZonesResponseSchema,
  type ListZonesResponse,
  shippingMethodSchema,
  type ShippingMethod,
  shippingZoneSchema,
  type ShippingZone,
  updateShippingMethodRequestSchema,
  type UpdateShippingMethodRequest,
  updateShippingZoneRequestSchema,
  type UpdateShippingZoneRequest,
} from './shipping.schemas';

const SHIPPING = ADMIN_API_ROUTES.shipping;

@Injectable({ providedIn: 'root' })
export class ShippingService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  listZones(query: ListPaginatedQuery = {}): Observable<ListZonesResponse> {
    const parsed = listPaginatedQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(SHIPPING.base, SHIPPING.zones)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listZonesResponseSchema.parse(raw)));
  }

  createZone(input: CreateShippingZoneRequest): Observable<ShippingZone> {
    const body = createShippingZoneRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(SHIPPING.base, SHIPPING.zones)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => shippingZoneSchema.parse(envelope(raw))));
  }

  updateZone(id: string, input: UpdateShippingZoneRequest): Observable<ShippingZone> {
    const body = updateShippingZoneRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(SHIPPING.base, fillRoute(SHIPPING.zoneById, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => shippingZoneSchema.parse(envelope(raw))));
  }

  listMethods(query: ListMethodsQuery = {}): Observable<ListMethodsResponse> {
    const parsed = listMethodsQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(SHIPPING.base, SHIPPING.methods)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listMethodsResponseSchema.parse(raw)));
  }

  createMethod(input: CreateShippingMethodRequest): Observable<ShippingMethod> {
    const body = createShippingMethodRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(SHIPPING.base, SHIPPING.methods)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => shippingMethodSchema.parse(envelope(raw))));
  }

  updateMethod(id: string, input: UpdateShippingMethodRequest): Observable<ShippingMethod> {
    const body = updateShippingMethodRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(SHIPPING.base, fillRoute(SHIPPING.methodById, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => shippingMethodSchema.parse(envelope(raw))));
  }

  deleteMethod(id: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiBase}/${adminRoute(SHIPPING.base, fillRoute(SHIPPING.methodById, { id }))}`,
        {
          withCredentials: true,
        },
      )
      .pipe(map(() => undefined));
  }
}
