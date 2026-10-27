import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope, rawLocaleContext, toParams } from '../shared';
import {
  type CreateTemplateRequest,
  createTemplateRequestSchema,
  type ListLogQuery,
  listLogQuerySchema,
  type ListLogResponse,
  listLogResponseSchema,
  type ListTemplatesQuery,
  listTemplatesQuerySchema,
  type ListTemplatesResponse,
  listTemplatesResponseSchema,
  type NotificationTemplate,
  notificationTemplateSchema,
  type PreviewTemplateRequest,
  previewTemplateRequestSchema,
  type PreviewTemplateResponse,
  previewTemplateResponseSchema,
  type ResendResponse,
  resendResponseSchema,
  type SendTestRequest,
  sendTestRequestSchema,
  type SendTestResponse,
  sendTestResponseSchema,
  type UpdateTemplateRequest,
  updateTemplateRequestSchema,
} from '@admin-types';

const NOTIFICATION_TEMPLATES = ADMIN_API_ROUTES.notificationTemplates;

/** `/v1/admin/notifications/{templates,log}` — template CRUD + send log. */
@Injectable({ providedIn: 'root' })
export class NotificationTemplatesService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  listTemplates(query: ListTemplatesQuery = {}): Observable<ListTemplatesResponse> {
    const parsed = listTemplatesQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(NOTIFICATION_TEMPLATES.base, NOTIFICATION_TEMPLATES.templates)}`,
        {
          params,
          context: rawLocaleContext(),
          withCredentials: true,
        },
      )
      .pipe(map((raw) => listTemplatesResponseSchema.parse(raw)));
  }

  getTemplate(id: string): Observable<NotificationTemplate> {
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(NOTIFICATION_TEMPLATES.base, fillRoute(NOTIFICATION_TEMPLATES.templateById, { id }))}`,
        {
          context: rawLocaleContext(),
          withCredentials: true,
        },
      )
      .pipe(map((raw) => notificationTemplateSchema.parse(envelope(raw))));
  }

  createTemplate(input: CreateTemplateRequest): Observable<NotificationTemplate> {
    const body = createTemplateRequestSchema.parse(input);
    return this.http
      .post<unknown>(
        `${this.apiBase}/${adminRoute(NOTIFICATION_TEMPLATES.base, NOTIFICATION_TEMPLATES.templates)}`,
        body,
        {
          context: rawLocaleContext(),
          withCredentials: true,
        },
      )
      .pipe(map((raw) => notificationTemplateSchema.parse(envelope(raw))));
  }

  updateTemplate(id: string, input: UpdateTemplateRequest): Observable<NotificationTemplate> {
    const body = updateTemplateRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(NOTIFICATION_TEMPLATES.base, fillRoute(NOTIFICATION_TEMPLATES.templateById, { id }))}`,
        body,
        {
          context: rawLocaleContext(),
          withCredentials: true,
        },
      )
      .pipe(map((raw) => notificationTemplateSchema.parse(envelope(raw))));
  }

  deleteTemplate(id: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiBase}/${adminRoute(NOTIFICATION_TEMPLATES.base, fillRoute(NOTIFICATION_TEMPLATES.templateById, { id }))}`,
        {
          withCredentials: true,
        },
      )
      .pipe(map(() => undefined));
  }

  listLog(query: ListLogQuery = {}): Observable<ListLogResponse> {
    const parsed = listLogQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(NOTIFICATION_TEMPLATES.base, NOTIFICATION_TEMPLATES.log)}`,
        {
          params,
          withCredentials: true,
        },
      )
      .pipe(map((raw) => listLogResponseSchema.parse(raw)));
  }

  resend(logId: string): Observable<ResendResponse> {
    return this.http
      .post<unknown>(
        `${this.apiBase}/${adminRoute(NOTIFICATION_TEMPLATES.base, fillRoute(NOTIFICATION_TEMPLATES.logResend, { id: logId }))}`,
        {},
        { withCredentials: true },
      )
      .pipe(map((raw) => resendResponseSchema.parse(envelope(raw))));
  }

  /** Server-side render of a DRAFT template for both locales (NE6). No send. */
  preview(id: string, input: PreviewTemplateRequest): Observable<PreviewTemplateResponse> {
    const body = previewTemplateRequestSchema.parse(input);
    return this.http
      .post<unknown>(
        `${this.apiBase}/${adminRoute(NOTIFICATION_TEMPLATES.base, fillRoute(NOTIFICATION_TEMPLATES.templatePreview, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => previewTemplateResponseSchema.parse(envelope(raw))));
  }

  /** Send a test of this template to the calling admin's own inbox (NE6). */
  sendTest(id: string, input: SendTestRequest = {}): Observable<SendTestResponse> {
    const body = sendTestRequestSchema.parse(input);
    return this.http
      .post<unknown>(
        `${this.apiBase}/${adminRoute(NOTIFICATION_TEMPLATES.base, fillRoute(NOTIFICATION_TEMPLATES.templateSendTest, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => sendTestResponseSchema.parse(envelope(raw))));
  }
}
