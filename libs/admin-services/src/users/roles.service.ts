import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope } from '../shared';
import {
  type CreateRoleRequest,
  createRoleRequestSchema,
  type Role,
  roleSchema,
  type UpdateRolePermissionsRequest,
  updateRolePermissionsRequestSchema,
} from './users.schemas';

const USERS = ADMIN_API_ROUTES.users;

/** /v1/admin/roles — role CRUD. See `apps/api/src/modules/users/users.controller.ts`. */
@Injectable({ providedIn: 'root' })
export class RolesService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  /** GET /v1/admin/roles */
  list(): Observable<Role[]> {
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(USERS.base, USERS.roles)}`, {
        withCredentials: true,
      })
      .pipe(
        map((raw) => {
          const data = envelope<unknown>(raw);
          return Array.isArray(data) ? data.map((d) => roleSchema.parse(d)) : [];
        }),
      );
  }

  /** POST /v1/admin/roles */
  create(input: CreateRoleRequest): Observable<Role> {
    const body = createRoleRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(USERS.base, USERS.roles)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => roleSchema.parse(envelope(raw))));
  }

  /** PATCH /v1/admin/roles/:id — replaces the full permission set. */
  updatePermissions(id: string, input: UpdateRolePermissionsRequest): Observable<Role> {
    const body = updateRolePermissionsRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(USERS.base, fillRoute(USERS.roleById, { id }))}`,
        body,
        { withCredentials: true },
      )
      .pipe(map((raw) => roleSchema.parse(envelope(raw))));
  }
}
