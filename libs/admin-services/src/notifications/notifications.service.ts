import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope, toParams } from '../shared';
import {
  listNotificationsQuerySchema,
  type ListNotificationsQuery,
  listNotificationsResponseSchema,
  type ListNotificationsResponse,
  type UnreadCount,
  unreadCountSchema,
} from '@admin-types';

const NOTIFICATIONS = ADMIN_API_ROUTES.notifications;

/** `/v1/admin/notifications/*` — per-admin in-app notifications. */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  /** GET /v1/admin/notifications — unread first. */
  list(query: ListNotificationsQuery = {}): Observable<ListNotificationsResponse> {
    const parsed = listNotificationsQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(NOTIFICATIONS.base)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listNotificationsResponseSchema.parse(raw)));
  }

  /** GET /v1/admin/notifications/unread-count */
  unreadCount(): Observable<UnreadCount> {
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(NOTIFICATIONS.base, NOTIFICATIONS.unreadCount)}`,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => unreadCountSchema.parse(envelope(raw))));
  }

  /** PATCH /v1/admin/notifications/:id/read */
  markRead(id: string): Observable<void> {
    return this.http
      .patch<void>(
        `${this.apiBase}/${adminRoute(NOTIFICATIONS.base, fillRoute(NOTIFICATIONS.read, { id }))}`,
        {},
        { withCredentials: true },
      )
      .pipe(map(() => undefined));
  }

  /** PATCH /v1/admin/notifications/read-all */
  markAllRead(): Observable<void> {
    return this.http
      .patch<void>(
        `${this.apiBase}/${adminRoute(NOTIFICATIONS.base, NOTIFICATIONS.readAll)}`,
        {},
        { withCredentials: true },
      )
      .pipe(map(() => undefined));
  }
}
