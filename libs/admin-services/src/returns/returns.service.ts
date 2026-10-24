import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope, toParams } from '../shared';
import {
  analyticsQuerySchema,
  type ReturnsAnalyticsQuery,
  returnsAnalyticsResponseSchema,
  type ReturnsAnalytics,
  listReturnsQuerySchema,
  type ListReturnsQuery,
  listReturnsResponseSchema,
  type ListReturnsResponse,
  receiveReturnRequestSchema,
  type ReceiveReturnRequest,
  refundReturnRequestSchema,
  type RefundReturnRequest,
  rejectReturnRequestSchema,
  type RejectReturnRequest,
  returnSchema,
  returnDetailSchema,
  type Return,
  type ReturnDetail,
} from './returns.schemas';

const RETURNS = ADMIN_API_ROUTES.returns;

/** `/v1/admin/returns/*` — admin workflow for customer returns. */
@Injectable({ providedIn: 'root' })
export class ReturnsService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  analytics(query: ReturnsAnalyticsQuery = {}): Observable<ReturnsAnalytics> {
    const parsed = analyticsQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(RETURNS.base, RETURNS.analytics)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => returnsAnalyticsResponseSchema.parse(envelope(raw))));
  }

  list(query: ListReturnsQuery = {}): Observable<ListReturnsResponse> {
    const parsed = listReturnsQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(RETURNS.base)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listReturnsResponseSchema.parse(raw)));
  }

  get(id: string): Observable<ReturnDetail> {
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(RETURNS.base, fillRoute(RETURNS.byId, { id }))}`,
        { withCredentials: true },
      )
      .pipe(map((raw) => returnDetailSchema.parse(envelope(raw))));
  }

  approve(id: string): Observable<Return> {
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(RETURNS.base, fillRoute(RETURNS.approve, { id }))}`,
        {},
        { withCredentials: true },
      )
      .pipe(map((raw) => returnSchema.parse(envelope(raw))));
  }

  reject(id: string, input: RejectReturnRequest): Observable<Return> {
    const body = rejectReturnRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(RETURNS.base, fillRoute(RETURNS.reject, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => returnSchema.parse(envelope(raw))));
  }

  receive(id: string, input: ReceiveReturnRequest): Observable<Return> {
    const body = receiveReturnRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(RETURNS.base, fillRoute(RETURNS.receive, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => returnSchema.parse(envelope(raw))));
  }

  /**
   * Issuing a refund requires `X-Idempotency-Key` (§3.6); without it the
   * endpoint 400s and the Refund action can never complete. One fresh key per
   * call, so a double-click replays instead of refunding twice.
   */
  refund(id: string, input: RefundReturnRequest): Observable<Return> {
    const body = refundReturnRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(RETURNS.base, fillRoute(RETURNS.refund, { id }))}`,
        body,
        {
          headers: { 'X-Idempotency-Key': crypto.randomUUID() },
          withCredentials: true,
        },
      )
      .pipe(map((raw) => returnSchema.parse(envelope(raw))));
  }

  close(id: string): Observable<Return> {
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(RETURNS.base, fillRoute(RETURNS.close, { id }))}`,
        {},
        { withCredentials: true },
      )
      .pipe(map((raw) => returnSchema.parse(envelope(raw))));
  }
}
