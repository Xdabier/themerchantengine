import { Inject, Injectable } from '@angular/core';

import { analyticsEventSchema, type AnalyticsEvent } from '@storefront-types';

import { STOREFRONT_API_CLIENT, type ApiClient } from '../shared/api-client.token';

/**
 * First-party analytics client for `POST /v1/analytics/events`.
 *
 * The endpoint has existed and been complete since the analytics module
 * shipped, and nothing ever called it, so every admin analytics dashboard read
 * an empty table (finding D2).
 *
 * Fire and forget by contract. The caller never awaits a result and never sees
 * an error: an analytics beacon must not delay a checkout redirect and must not
 * be able to fail a page.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsApiService {
  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  async send(event: AnalyticsEvent): Promise<void> {
    // Parsed before the post: the endpoint answers 204 with no body, so a
    // malformed emission would otherwise be an invisible gap in the dashboards.
    const body = analyticsEventSchema.parse(event);
    // A page view is posted while the router navigates, and WebKit aborts a
    // fetch still in flight on navigation unless it is a keepalive request.
    await this.api.post('/v1/analytics/events', body, { keepalive: true });
  }
}
