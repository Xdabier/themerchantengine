import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope, toParams } from '../shared';
import {
  cmsPageSchema,
  type CmsPage,
  createPageRequestSchema,
  type CreatePageRequest,
  listPagesQuerySchema,
  type ListPagesQuery,
  listPagesResponseSchema,
  type ListPagesResponse,
  updatePageRequestSchema,
  type UpdatePageRequest,
} from './cms.schemas';

const CMS = ADMIN_API_ROUTES.cms;

/** `/v1/admin/pages/*` — CMS page CRUD with soft-delete. */
@Injectable({ providedIn: 'root' })
export class CmsService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  list(query: ListPagesQuery = {}): Observable<ListPagesResponse> {
    const parsed = listPagesQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(CMS.base)}`, { params, withCredentials: true })
      .pipe(map((raw) => listPagesResponseSchema.parse(raw)));
  }

  create(input: CreatePageRequest): Observable<CmsPage> {
    const body = createPageRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(CMS.base)}`, body, { withCredentials: true })
      .pipe(map((raw) => cmsPageSchema.parse(envelope(raw))));
  }

  update(id: string, input: UpdatePageRequest): Observable<CmsPage> {
    const body = updatePageRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(CMS.base, fillRoute(CMS.byId, { id }))}`,
        body,
        { withCredentials: true },
      )
      .pipe(map((raw) => cmsPageSchema.parse(envelope(raw))));
  }

  delete(id: string): Observable<void> {
    return this.http
      .delete<void>(`${this.apiBase}/${adminRoute(CMS.base, fillRoute(CMS.byId, { id }))}`, {
        withCredentials: true,
      })
      .pipe(map(() => undefined));
  }
}
