import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope, toParams } from '../shared';
import {
  createWebhookRequestSchema,
  type CreateWebhookRequest,
  listDeliveriesQuerySchema,
  type ListDeliveriesQuery,
  listDeliveriesResponseSchema,
  type ListDeliveriesResponse,
  listWebhooksQuerySchema,
  type ListWebhooksQuery,
  listWebhooksResponseSchema,
  type ListWebhooksResponse,
  updateWebhookRequestSchema,
  type UpdateWebhookRequest,
  webhookSchema,
  type Webhook,
  webhookTestResultSchema,
  type WebhookTestResult,
  webhookWithSecretSchema,
  type WebhookWithSecret,
} from './webhooks.schemas';

const WEBHOOKS = ADMIN_API_ROUTES.webhooks;

/**
 * `/v1/admin/webhooks/*` — outbound HMAC-signed subscriptions.
 *
 * Secret is returned ONLY on create — UI should surface it once and then
 * discard. Subsequent GET/list responses omit it.
 */
@Injectable({ providedIn: 'root' })
export class WebhooksService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  create(input: CreateWebhookRequest): Observable<WebhookWithSecret> {
    const body = createWebhookRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(WEBHOOKS.base)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => webhookWithSecretSchema.parse(envelope(raw))));
  }

  list(query: ListWebhooksQuery = {}): Observable<ListWebhooksResponse> {
    const parsed = listWebhooksQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(WEBHOOKS.base)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listWebhooksResponseSchema.parse(raw)));
  }

  get(id: string): Observable<Webhook> {
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(WEBHOOKS.base, fillRoute(WEBHOOKS.byId, { id }))}`,
        { withCredentials: true },
      )
      .pipe(map((raw) => webhookSchema.parse(envelope(raw))));
  }

  update(id: string, input: UpdateWebhookRequest): Observable<Webhook> {
    const body = updateWebhookRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(WEBHOOKS.base, fillRoute(WEBHOOKS.byId, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => webhookSchema.parse(envelope(raw))));
  }

  remove(id: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiBase}/${adminRoute(WEBHOOKS.base, fillRoute(WEBHOOKS.byId, { id }))}`,
        { withCredentials: true },
      )
      .pipe(map(() => undefined));
  }

  /**
   * The endpoint requires `X-Idempotency-Key` (§3.6); without it the Send test
   * event button 400s on every click. One fresh key per call, so a double-click
   * replays instead of delivering a second test event.
   */
  test(id: string): Observable<WebhookTestResult> {
    return this.http
      .post<unknown>(
        `${this.apiBase}/${adminRoute(WEBHOOKS.base, fillRoute(WEBHOOKS.test, { id }))}`,
        {},
        {
          headers: { 'X-Idempotency-Key': crypto.randomUUID() },
          withCredentials: true,
        },
      )
      .pipe(map((raw) => webhookTestResultSchema.parse(envelope(raw))));
  }

  deliveries(id: string, query: ListDeliveriesQuery = {}): Observable<ListDeliveriesResponse> {
    const parsed = listDeliveriesQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(WEBHOOKS.base, fillRoute(WEBHOOKS.deliveries, { id }))}`,
        {
          params,
          withCredentials: true,
        },
      )
      .pipe(map((raw) => listDeliveriesResponseSchema.parse(raw)));
  }
}
