import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { adminUserSchema, type AdminUser, type PaginationMeta } from '@admin-types';
import { ADMIN_API_BASE_URL, envelope, toParams } from '../shared';
import {
  type Address,
  addressSchema,
  type CreateStaffRequest,
  createStaffRequestSchema,
  type Customer,
  customerSchema,
  type CustomerSegmentSummary,
  customerSegmentSummarySchema,
  type ListCustomersQuery,
  listCustomersQuerySchema,
  type ListCustomersResponse,
  listCustomersResponseSchema,
  type ListStaffQuery,
  listStaffQuerySchema,
  type StaffMember,
  staffMemberSchema,
  type UpdateCustomerRequest,
  updateCustomerRequestSchema,
  type UpdateMeRequest,
  updateMeRequestSchema,
  type UpdateStaffRequest,
  updateStaffRequestSchema,
  type UpsertAddressRequest,
  upsertAddressRequestSchema,
} from './users.schemas';

const USERS = ADMIN_API_ROUTES.users;

/**
 * Wraps `UsersController` at apps/api/src/modules/users/users.controller.ts.
 * Covers:
 *   - Customer directory (admin)
 *   - Staff management (admin)
 *   - Own profile + address book (`/v1/users/me`, authenticated-any)
 *
 * Role endpoints live in RolesService for a cleaner domain split even though
 * they share the same controller on the backend.
 */
@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  /* -------- Self-service (every authenticated user) -------- */

  /**
   * GET /v1/users/me — the current user's profile.
   *
   * The Better Auth session cookie authorises the request (the
   * `credentialsInterceptor` attaches `withCredentials`); there is no bearer
   * token. The session itself is resolved at boot by `session-bootstrap.ts`
   * via a single `getSession()` — this call is for screens that re-read the
   * profile afterwards (e.g. `MePage`).
   */
  me(): Observable<AdminUser> {
    return this.http
      .get<unknown>(`${this.apiBase}/v1/users/me`, { withCredentials: true })
      .pipe(map((raw) => adminUserSchema.parse(envelope(raw))));
  }

  /** PATCH /v1/users/me */
  updateMe(input: UpdateMeRequest): Observable<AdminUser> {
    const body = updateMeRequestSchema.parse(input);
    return this.http
      .patch<unknown>(`${this.apiBase}/v1/users/me`, body, { withCredentials: true })
      .pipe(map((raw) => adminUserSchema.parse(envelope(raw))));
  }

  /** POST /v1/users/me/addresses */
  createAddress(input: UpsertAddressRequest): Observable<Address> {
    const body = upsertAddressRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/v1/users/me/addresses`, body, { withCredentials: true })
      .pipe(map((raw) => addressSchema.parse(envelope(raw))));
  }

  /** PATCH /v1/users/me/addresses/:id */
  updateAddress(id: string, input: UpsertAddressRequest): Observable<Address> {
    const body = upsertAddressRequestSchema.parse(input);
    return this.http
      .patch<unknown>(`${this.apiBase}/v1/users/me/addresses/${id}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => addressSchema.parse(envelope(raw))));
  }

  /** DELETE /v1/users/me/addresses/:id */
  deleteAddress(id: string): Observable<void> {
    return this.http
      .delete<void>(`${this.apiBase}/v1/users/me/addresses/${id}`, { withCredentials: true })
      .pipe(map(() => undefined));
  }

  /** PATCH /v1/users/me/addresses/:id/default — marks as default, returns the address. */
  setDefaultAddress(id: string): Observable<Address> {
    return this.http
      .patch<unknown>(
        `${this.apiBase}/v1/users/me/addresses/${id}/default`,
        {},
        { withCredentials: true },
      )
      .pipe(map((raw) => addressSchema.parse(envelope(raw))));
  }

  /* -------- Customers (admin) -------- */

  /** GET /v1/admin/customers — paginated. */
  listCustomers(query: ListCustomersQuery = {}): Observable<ListCustomersResponse> {
    const parsed = listCustomersQuerySchema.parse(query);
    const params = new HttpParams({
      fromObject: toParams(parsed as Record<string, unknown> as never),
    });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(USERS.base, USERS.customers)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listCustomersResponseSchema.parse(raw)));
  }

  /** GET /v1/admin/customers/:id */
  getCustomer(id: string): Observable<Customer> {
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(USERS.base, fillRoute(USERS.customerById, { id }))}`,
        { withCredentials: true },
      )
      .pipe(map((raw) => customerSchema.parse(envelope(raw))));
  }

  /** GET /v1/admin/customers/segments — may shadow per route-order caveat (see API ref). */
  listCustomerSegments(): Observable<CustomerSegmentSummary[]> {
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(USERS.base, USERS.customerSegments)}`, {
        withCredentials: true,
      })
      .pipe(
        map((raw) => {
          const data = envelope<unknown>(raw);
          return Array.isArray(data) ? data.map((d) => customerSegmentSummarySchema.parse(d)) : [];
        }),
      );
  }

  /** PATCH /v1/admin/customers/:id */
  updateCustomer(id: string, input: UpdateCustomerRequest): Observable<Customer> {
    const body = updateCustomerRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(USERS.base, fillRoute(USERS.customerById, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => customerSchema.parse(envelope(raw))));
  }

  /* -------- Staff (admin) -------- */

  /** GET /v1/admin/staff — paginated. */
  listStaff(query: ListStaffQuery = {}): Observable<{ data: StaffMember[]; meta: PaginationMeta }> {
    const parsed = listStaffQuerySchema.parse(query);
    const params = new HttpParams({
      fromObject: toParams(parsed as Record<string, unknown> as never),
    });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(USERS.base, USERS.staff)}`, {
        params,
        withCredentials: true,
      })
      .pipe(
        map((raw) => {
          const r = raw as { data: unknown[]; meta: PaginationMeta };
          return {
            // staffMemberSchema, not adminUserSchema: the latter strips `role`
            // and `customRole` off the wire and defaults `status` to active.
            data: r.data.map((d) => staffMemberSchema.parse(d)),
            meta: r.meta,
          };
        }),
      );
  }

  /**
   * POST /v1/admin/staff
   *
   * `staffMemberSchema`, for the same reason the list uses it: the response is
   * a staff row carrying a base `role` plus `customRole` and `isActive`, none
   * of which survive `adminUserSchema`. Parsing it as an admin user dropped the
   * ROLES cell and defaulted `status` to active on the freshly created row.
   */
  createStaff(input: CreateStaffRequest): Observable<StaffMember> {
    const body = createStaffRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(USERS.base, USERS.staff)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => staffMemberSchema.parse(envelope(raw))));
  }

  /** PATCH /v1/admin/staff/:id — a staff row, not an admin user. See `createStaff`. */
  updateStaff(id: string, input: UpdateStaffRequest): Observable<StaffMember> {
    const body = updateStaffRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(USERS.base, fillRoute(USERS.staffById, { id }))}`,
        body,
        { withCredentials: true },
      )
      .pipe(map((raw) => staffMemberSchema.parse(envelope(raw))));
  }

  /** DELETE /v1/admin/staff/:id — deactivates + audit trail. */
  deactivateStaff(id: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiBase}/${adminRoute(USERS.base, fillRoute(USERS.staffById, { id }))}`,
        { withCredentials: true },
      )
      .pipe(map(() => undefined));
  }
}
