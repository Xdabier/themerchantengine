import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../shared/api-client.token';
import { CheckoutService } from './checkout.service';

function mockClient(get: ApiClient['get']): ApiClient {
  return {
    get,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  } as unknown as ApiClient;
}

const payload = {
  checkout: {
    guestCheckoutEnabled: true,
    requiredFields: ['email'],
    termsOfServiceUrl: null,
    postPurchaseRedirectUrl: null,
    checkoutMessage: null,
  },
  paymentMethods: [
    { code: 'cod', name: 'Cash on delivery', description: null, provider: 'cod', sortOrder: 0 },
  ],
};

describe('CheckoutService', () => {
  it('getSettings reads the public endpoint and unwraps the envelope', async () => {
    const get = vi.fn(async () => ({ data: payload })) as ApiClient['get'];
    const svc = new CheckoutService(mockClient(get));
    const settings = await svc.getSettings();
    expect(get).toHaveBeenCalledWith('/v1/checkout/settings');
    expect(settings.checkout.guestCheckoutEnabled).toBe(true);
    expect(settings.paymentMethods).toHaveLength(1);
  });

  it('getSettings surfaces an empty method list untouched', async () => {
    const get = vi.fn(async () => ({
      data: { ...payload, paymentMethods: [] },
    })) as ApiClient['get'];
    const svc = new CheckoutService(mockClient(get));
    const settings = await svc.getSettings();
    expect(settings.paymentMethods).toEqual([]);
  });

  it('getSettings throws when a payment method arrives with its config blob', async () => {
    const get = vi.fn(async () => ({
      data: {
        ...payload,
        paymentMethods: [{ ...payload.paymentMethods[0], config: { apiKey: 'sk_live_leaked' } }],
      },
    })) as ApiClient['get'];
    const svc = new CheckoutService(mockClient(get));
    await expect(svc.getSettings()).rejects.toThrow();
  });

  it('getSettings throws when the guest flag is missing rather than defaulting it off', async () => {
    const rest: Partial<typeof payload.checkout> = { ...payload.checkout };
    delete rest.guestCheckoutEnabled;
    const get = vi.fn(async () => ({ data: { ...payload, checkout: rest } })) as ApiClient['get'];
    const svc = new CheckoutService(mockClient(get));
    await expect(svc.getSettings()).rejects.toThrow();
  });
});
