import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope, rawLocaleContext, toParams } from '../shared';
import {
  type Campaign,
  campaignSchema,
  type CampaignStats,
  campaignStatsSchema,
  type CreateCampaignRequest,
  createCampaignRequestSchema,
  type ListCampaignsQuery,
  listCampaignsQuerySchema,
  type ListCampaignsResponse,
  listCampaignsResponseSchema,
  type ListSubscribersQuery,
  listSubscribersQuerySchema,
  type ListSubscribersResponse,
  listSubscribersResponseSchema,
  type PreviewCampaignRequest,
  previewCampaignRequestSchema,
  type PreviewCampaignResponse,
  previewCampaignResponseSchema,
  type SendCampaignResponse,
  sendCampaignResponseSchema,
  type SendTestCampaignRequest,
  sendTestCampaignRequestSchema,
  type SendTestCampaignResponse,
  sendTestCampaignResponseSchema,
  type Subscriber,
  subscriberSchema,
  type UpdateCampaignRequest,
  updateCampaignRequestSchema,
  type UpdateSubscriberRequest,
  updateSubscriberRequestSchema,
} from '@admin-types';

const CAMPAIGNS = ADMIN_API_ROUTES.campaigns;
const SUBSCRIBERS = ADMIN_API_ROUTES.subscribers;

/** `/v1/admin/campaigns` + `/v1/admin/subscribers` — the marketing plane (NE9). */
@Injectable({ providedIn: 'root' })
export class CampaignsService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  listCampaigns(query: ListCampaignsQuery = {}): Observable<ListCampaignsResponse> {
    const parsed = listCampaignsQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(CAMPAIGNS.base)}`, {
        params,
        context: rawLocaleContext(),
        withCredentials: true,
      })
      .pipe(map((raw) => listCampaignsResponseSchema.parse(raw)));
  }

  getCampaign(id: string): Observable<Campaign> {
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(CAMPAIGNS.base, fillRoute(CAMPAIGNS.byId, { id }))}`,
        {
          context: rawLocaleContext(),
          withCredentials: true,
        },
      )
      .pipe(map((raw) => campaignSchema.parse(envelope(raw))));
  }

  createCampaign(input: CreateCampaignRequest): Observable<Campaign> {
    const body = createCampaignRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(CAMPAIGNS.base)}`, body, {
        context: rawLocaleContext(),
        withCredentials: true,
      })
      .pipe(map((raw) => campaignSchema.parse(envelope(raw))));
  }

  updateCampaign(id: string, input: UpdateCampaignRequest): Observable<Campaign> {
    const body = updateCampaignRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(CAMPAIGNS.base, fillRoute(CAMPAIGNS.byId, { id }))}`,
        body,
        {
          context: rawLocaleContext(),
          withCredentials: true,
        },
      )
      .pipe(map((raw) => campaignSchema.parse(envelope(raw))));
  }

  deleteCampaign(id: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiBase}/${adminRoute(CAMPAIGNS.base, fillRoute(CAMPAIGNS.byId, { id }))}`,
        { withCredentials: true },
      )
      .pipe(map(() => undefined));
  }

  sendCampaign(id: string): Observable<SendCampaignResponse> {
    return this.http
      .post<unknown>(
        `${this.apiBase}/${adminRoute(CAMPAIGNS.base, fillRoute(CAMPAIGNS.send, { id }))}`,
        {},
        { withCredentials: true },
      )
      .pipe(map((raw) => sendCampaignResponseSchema.parse(envelope(raw))));
  }

  sendTestCampaign(
    id: string,
    input: SendTestCampaignRequest = {},
  ): Observable<SendTestCampaignResponse> {
    const body = sendTestCampaignRequestSchema.parse(input);
    return this.http
      .post<unknown>(
        `${this.apiBase}/${adminRoute(CAMPAIGNS.base, fillRoute(CAMPAIGNS.test, { id }))}`,
        body,
        { withCredentials: true },
      )
      .pipe(map((raw) => sendTestCampaignResponseSchema.parse(envelope(raw))));
  }

  preview(id: string, input: PreviewCampaignRequest): Observable<PreviewCampaignResponse> {
    const body = previewCampaignRequestSchema.parse(input);
    return this.http
      .post<unknown>(
        `${this.apiBase}/${adminRoute(CAMPAIGNS.base, fillRoute(CAMPAIGNS.preview, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => previewCampaignResponseSchema.parse(envelope(raw))));
  }

  campaignStats(id: string): Observable<CampaignStats> {
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(CAMPAIGNS.base, fillRoute(CAMPAIGNS.stats, { id }))}`,
        { withCredentials: true },
      )
      .pipe(map((raw) => campaignStatsSchema.parse(envelope(raw))));
  }

  listSubscribers(query: ListSubscribersQuery = {}): Observable<ListSubscribersResponse> {
    const parsed = listSubscribersQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(SUBSCRIBERS.base)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listSubscribersResponseSchema.parse(raw)));
  }

  updateSubscriber(id: string, input: UpdateSubscriberRequest): Observable<Subscriber> {
    const body = updateSubscriberRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(SUBSCRIBERS.base, fillRoute(SUBSCRIBERS.byId, { id }))}`,
        body,
        { withCredentials: true },
      )
      .pipe(map((raw) => subscriberSchema.parse(envelope(raw))));
  }
}
