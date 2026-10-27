import { Inject, Injectable } from '@angular/core';

import {
  storefrontCheckoutSettingsResponseSchema,
  type StorefrontCheckoutSettings,
} from '@storefront-types';

import { STOREFRONT_API_CLIENT, type ApiClient } from '../shared/api-client.token';

/**
 * Storefront checkout configuration service. Wraps the public
 * `GET /v1/checkout/settings`, which the checkout page reads once at
 * bootstrap.
 *
 * Read-only and public by design: no session is required, because the page has
 * to know whether guest checkout is allowed before it knows who the visitor
 * is. Placing an order lives on `OrdersService`, not here.
 */
@Injectable({ providedIn: 'root' })
export class CheckoutService {
  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  async getSettings(): Promise<StorefrontCheckoutSettings> {
    const envelope = await this.api.get<unknown>('/v1/checkout/settings');
    return storefrontCheckoutSettingsResponseSchema.parse(envelope).data;
  }
}
