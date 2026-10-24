import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, toParams } from '../shared';
import {
  type ListAuditLogQuery,
  listAuditLogQuerySchema,
  type ListAuditLogResponse,
  listAuditLogResponseSchema,
} from './audit-log.schemas';

const AUDIT_LOG = ADMIN_API_ROUTES.auditLog;

/** `/v1/admin/audit-log/*`. */
@Injectable({ providedIn: 'root' })
export class AuditLogService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  /** GET /v1/admin/audit-log */
  list(query: ListAuditLogQuery = {}): Observable<ListAuditLogResponse> {
    const parsed = listAuditLogQuerySchema.parse(query);
    const params = new HttpParams({
      fromObject: toParams(parsed as Record<string, unknown> as never),
    });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(AUDIT_LOG.base)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listAuditLogResponseSchema.parse(raw)));
  }

  /** GET /v1/admin/audit-log/:entityType/:entityId */
  listByEntity(
    entityType: string,
    entityId: string,
    query: ListAuditLogQuery = {},
  ): Observable<ListAuditLogResponse> {
    const parsed = listAuditLogQuerySchema.parse(query);
    const params = new HttpParams({
      fromObject: toParams(parsed as Record<string, unknown> as never),
    });
    const url = `${this.apiBase}/${adminRoute(AUDIT_LOG.base, fillRoute(AUDIT_LOG.byEntity, { entityType, entityId }))}`;
    return this.http
      .get<unknown>(url, { params, withCredentials: true })
      .pipe(map((raw) => listAuditLogResponseSchema.parse(raw)));
  }
}
