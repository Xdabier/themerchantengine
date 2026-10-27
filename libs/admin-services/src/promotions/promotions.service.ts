import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope, rawLocaleContext, toParams } from '../shared';
import {
  createPromotionRequestSchema,
  type CreatePromotionRequest,
  listPromotionsQuerySchema,
  type ListPromotionsQuery,
  listPromotionsResponseSchema,
  type ListPromotionsResponse,
  type Promotion,
  promotionSchema,
  updatePromotionRequestSchema,
  type UpdatePromotionRequest,
} from './promotions.schemas';

const PROMOTIONS = ADMIN_API_ROUTES.promotions;

/** `/v1/admin/promotions/*`. Soft-deactivate on DELETE. */
@Injectable({ providedIn: 'root' })
export class PromotionsService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  list(query: ListPromotionsQuery = {}): Observable<ListPromotionsResponse> {
    const parsed = listPromotionsQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(PROMOTIONS.base, PROMOTIONS.adminList)}`, {
        params,
        context: rawLocaleContext(),
        withCredentials: true,
      })
      .pipe(map((raw) => listPromotionsResponseSchema.parse(raw)));
  }

  get(id: string): Observable<Promotion> {
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(PROMOTIONS.base, fillRoute(PROMOTIONS.adminById, { id }))}`,
        {
          context: rawLocaleContext(),
          withCredentials: true,
        },
      )
      .pipe(map((raw) => promotionSchema.parse(envelope(raw))));
  }

  create(input: CreatePromotionRequest): Observable<Promotion> {
    const body = createPromotionRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(PROMOTIONS.base, PROMOTIONS.adminList)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => promotionSchema.parse(envelope(raw))));
  }

  update(id: string, input: UpdatePromotionRequest): Observable<Promotion> {
    const body = updatePromotionRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(PROMOTIONS.base, fillRoute(PROMOTIONS.adminById, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => promotionSchema.parse(envelope(raw))));
  }

  /** Soft-deactivate: isActive = false + deletedAt = now. */
  deactivate(id: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiBase}/${adminRoute(PROMOTIONS.base, fillRoute(PROMOTIONS.adminById, { id }))}`,
        { withCredentials: true },
      )
      .pipe(map(() => undefined));
  }
}
