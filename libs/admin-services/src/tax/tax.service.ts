import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope, toParams } from '../shared';
import {
  createTaxClassRequestSchema,
  type CreateTaxClassRequest,
  createTaxZoneRequestSchema,
  type CreateTaxZoneRequest,
  listClassesQuerySchema,
  listClassesResponseSchema,
  listPaginatedQuerySchema,
  type ListPaginatedQuery,
  listZonesResponseSchema,
  type ListTaxClassesQuery,
  type ListTaxClassesResponse,
  type ListTaxZonesResponse,
  taxClassSchema,
  type TaxClass,
  taxZoneSchema,
  type TaxZone,
  updateTaxZoneRequestSchema,
  type UpdateTaxZoneRequest,
} from './tax.schemas';

const TAX = ADMIN_API_ROUTES.tax;

/** `/v1/admin/tax/*` — tax zones + classes. */
@Injectable({ providedIn: 'root' })
export class TaxService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  listZones(query: ListPaginatedQuery = {}): Observable<ListTaxZonesResponse> {
    const parsed = listPaginatedQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(TAX.base, TAX.zones)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listZonesResponseSchema.parse(raw)));
  }

  getZone(id: string): Observable<TaxZone> {
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(TAX.base, fillRoute(TAX.zoneById, { id }))}`, {
        withCredentials: true,
      })
      .pipe(map((raw) => taxZoneSchema.parse(envelope(raw))));
  }

  createZone(input: CreateTaxZoneRequest): Observable<TaxZone> {
    const body = createTaxZoneRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(TAX.base, TAX.zones)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => taxZoneSchema.parse(envelope(raw))));
  }

  updateZone(id: string, input: UpdateTaxZoneRequest): Observable<TaxZone> {
    const body = updateTaxZoneRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(TAX.base, fillRoute(TAX.zoneById, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => taxZoneSchema.parse(envelope(raw))));
  }

  listClasses(query: ListTaxClassesQuery = {}): Observable<ListTaxClassesResponse> {
    const parsed = listClassesQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(TAX.base, TAX.classes)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listClassesResponseSchema.parse(raw)));
  }

  createClass(input: CreateTaxClassRequest): Observable<TaxClass> {
    const body = createTaxClassRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(TAX.base, TAX.classes)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => taxClassSchema.parse(envelope(raw))));
  }
}
