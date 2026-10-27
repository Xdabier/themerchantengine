import { Inject, Injectable } from '@angular/core';

import {
  storefrontRuntimeConfigResponseSchema,
  type StorefrontRuntimeConfig,
} from '@storefront-types';

import { STOREFRONT_API_CLIENT, type ApiClient } from '../shared/api-client.token';

/**
 * Runtime store config client. Wraps `GET /v1/store/config` (DR-31, plan E1.2).
 *
 * This is the endpoint the generic engine reads for everything that used to be
 * baked into a client build: the identity, the palette, the locale set and the
 * money format. Read once per render at SSR boot and carried to the browser
 * through TransferState, so it is not a per-page call.
 *
 * Deliberately sends no `X-Resolve-Locale` header: the default read resolves
 * the Translatable fields against the request locale the API client already
 * carries, which is what a page wants. See `runtime-config.schemas.ts`.
 *
 * The narrower `StoreConfigApiService` still exists beside this one. It carries
 * the social links, the vendor pixels and the low-stock threshold, which have
 * no home in the runtime config groups yet.
 */
@Injectable({ providedIn: 'root' })
export class StoreRuntimeConfigApiService {
  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  async get(): Promise<StorefrontRuntimeConfig> {
    const envelope = await this.api.get<unknown>('/v1/store/config');
    return storefrontRuntimeConfigResponseSchema.parse(envelope).data;
  }
}
