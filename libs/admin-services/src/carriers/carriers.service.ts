import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope, toParams } from '../shared';
import {
  type Carrier,
  carrierSchema,
  type CreateCarrierRequest,
  createCarrierRequestSchema,
  type ListCarriersQuery,
  listCarriersQuerySchema,
  type ListCarriersResponse,
  listCarriersResponseSchema,
  type UpdateCarrierRequest,
  updateCarrierRequestSchema,
} from './carriers.schemas';

const CARRIERS = ADMIN_API_ROUTES.carriers;

@Injectable({ providedIn: 'root' })
export class CarriersService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  list(query: ListCarriersQuery = {}): Observable<ListCarriersResponse> {
    const parsed = listCarriersQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(CARRIERS.base)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listCarriersResponseSchema.parse(raw)));
  }

  get(id: string): Observable<Carrier> {
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(CARRIERS.base, fillRoute(CARRIERS.byId, { id }))}`,
        { withCredentials: true },
      )
      .pipe(map((raw) => carrierSchema.parse(envelope(raw))));
  }

  create(input: CreateCarrierRequest): Observable<Carrier> {
    const body = createCarrierRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(CARRIERS.base)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => carrierSchema.parse(envelope(raw))));
  }

  update(id: string, input: UpdateCarrierRequest): Observable<Carrier> {
    const body = updateCarrierRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(CARRIERS.base, fillRoute(CARRIERS.byId, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => carrierSchema.parse(envelope(raw))));
  }

  delete(id: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiBase}/${adminRoute(CARRIERS.base, fillRoute(CARRIERS.byId, { id }))}`,
        { withCredentials: true },
      )
      .pipe(map(() => undefined));
  }
}
