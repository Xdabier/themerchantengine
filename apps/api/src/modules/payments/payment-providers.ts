import { CodPaymentProvider } from './providers/cod-payment.provider';
import { ManualPaymentProvider } from './providers/manual-payment.provider';
import { StripePaymentProvider } from './providers/stripe-payment.provider';

/** The one list of payment providers the engine runs. Add a provider here to register it. */
export const PAYMENT_PROVIDER_IMPLEMENTATIONS = [
  CodPaymentProvider,
  ManualPaymentProvider,
  StripePaymentProvider,
] as const;

export type RegisteredPaymentProviderId =
  (typeof PAYMENT_PROVIDER_IMPLEMENTATIONS)[number]['providerId'];

export const REGISTERED_PAYMENT_PROVIDER_IDS: readonly RegisteredPaymentProviderId[] =
  PAYMENT_PROVIDER_IMPLEMENTATIONS.map((provider) => provider.providerId);

/** The registered providers the storefront checkout may offer. */
export const CHECKOUT_PAYMENT_PROVIDER_IDS: readonly RegisteredPaymentProviderId[] =
  PAYMENT_PROVIDER_IMPLEMENTATIONS.filter((provider) => provider.offeredAtCheckout).map(
    (provider) => provider.providerId,
  );
