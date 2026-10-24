import { Inject, Injectable } from '@angular/core';
import {
  apiResponseSchema,
  notificationPreferencesSchema,
  updateNotificationPreferencesRequestSchema,
  type NotificationPreferences,
  type UpdateNotificationPreferencesRequest,
} from '@storefront-types';
import { STOREFRONT_API_CLIENT, type ApiClient } from '../shared/api-client.token';

/**
 * Customer notification-preference center (NE7). Reads/writes the caller's own
 * per-category email consent via the `@OwnerGuard()`-protected
 * `/v1/users/me/notification-preferences` endpoints.
 */
@Injectable({ providedIn: 'root' })
export class NotificationPreferencesService {
  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  async getPreferences(): Promise<NotificationPreferences> {
    const envelope = await this.api.get<unknown>('/v1/users/me/notification-preferences');
    return apiResponseSchema(notificationPreferencesSchema).parse(envelope).data;
  }

  async updatePreferences(
    input: UpdateNotificationPreferencesRequest,
  ): Promise<NotificationPreferences> {
    const body = updateNotificationPreferencesRequestSchema.parse(input);
    const envelope = await this.api.patch<unknown>('/v1/users/me/notification-preferences', body);
    return apiResponseSchema(notificationPreferencesSchema).parse(envelope).data;
  }
}
