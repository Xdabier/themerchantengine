import { Inject, Injectable } from '@angular/core';

import { storefrontConfigResponseSchema, type StorefrontConfig } from '@storefront-types';

import { STOREFRONT_API_CLIENT, type ApiClient } from '../shared/api-client.token';

/**
 * Public store configuration client. Wraps `GET /v1/storefront/config`.
 *
 * Read once per render at SSR boot and carried to the browser through
 * TransferState, so this is not a per-page call. Public by design: it answers
 * what the store is called and what it charges in, which every visitor needs
 * before anyone knows who they are.
 */
@Injectable({ providedIn: 'root' })
export class StoreConfigApiService {
  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  async get(): Promise<StorefrontConfig> {
    const envelope = await this.api.get<unknown>('/v1/storefront/config');
    return storefrontConfigResponseSchema.parse(envelope).data;
  }
}
