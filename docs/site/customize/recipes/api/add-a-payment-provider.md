---
title: Add a payment provider
description: "How a payment provider plugs into the engine: the PaymentProvider interface, the one registry list, the gateway that holds the config, the conformance suite every provider passes, secrets from env, signed and deduped webhooks, and the switch that puts it on the storefront checkout. Stripe is the worked example."
primaryQuery: add a payment gateway nestjs ecommerce stripe
updated: 2026-10-23
schema: HowTo
---

## When you need this

You want a payment provider the engine does not ship. The engine ships three:

- `cod`, cash on delivery.
- `manual`, a bank transfer the operator confirms.
- `stripe`, a card example on Stripe Payment Intents with manual capture. It is registered but not offered at checkout, because no storefront step collects the card yet.

Gift cards are not a provider. A gift card is a code applied to the cart, and `GiftCardsService.redeem` in `apps/api/src/modules/gift-cards/gift-cards.service.ts` is an atomic, WHERE-guarded decrement.

Every provider sits behind one interface and one gateway. Adding one is a class, one line in the registry, one entry in the conformance suite, and the env keys it reads.

## Files you touch

- `apps/api/src/modules/payments/providers/payment-provider.interface.ts`: the `PaymentProvider<TConfig>` interface and its input and result types.
- `apps/api/src/modules/payments/providers/<id>-payment.provider.ts`: your provider. `stripe-payment.provider.ts` is the card example, `offline-payment.provider.ts` the base for providers where the money moves outside the engine.
- `apps/api/src/modules/payments/payment-providers.ts`: `PAYMENT_PROVIDER_IMPLEMENTATIONS`, the one list of providers the engine runs.
- `apps/api/src/modules/payments/providers/payment-provider.conformance.spec.ts`: the shared suite every provider passes.
- `apps/api/src/modules/payments/payment-gateway.service.ts`: the only door from orders to a provider. You read it, you do not change it.
- `tools/setup/src/steps/payments.ts` and `tools/setup/src/output/compose-env.ts`: the setup prompts and the env keys they write.
- `apps/admin/src/app/features/payments/payment-method-new.page.ts`: the admin form that creates a method row.
- `prisma/seeds/store-config/payment-methods.ts`: the seed that plants `cod`, create-only.

## The pattern

### 1. The interface

`apps/api/src/modules/payments/providers/payment-provider.interface.ts` declares what a provider does:

- `id` and `configSchema`, a Zod schema for the method row's `config` blob.
- `createSession(input)`: called once at order create. Gets `orderId`, `amount` (a `Prisma.Decimal`), `currencyCode` and the parsed `config`. Returns a `reference`, a `status` and, for a redirect or a client-side step, `redirectUrl` or `clientSecret`.
- `authorize`, `getStatus`: read or confirm the remote state.
- `capture`, `cancel`, `refund`: move money. Each gets an `idempotencyKey`. `capture` and `refund` also get `amount` and `currencyCode`, and `refund` gets `refundableAmount`.
- `parseWebhook(input)`: gets the `headers`, the exact `rawBody` bytes and the `config`. Verifies the signature and returns `{ eventId, reference, status }`.

A provider never writes to the database. It answers with a status, and the orders module persists it.

### 2. Register it

Add the class to `apps/api/src/modules/payments/payment-providers.ts`:

```ts
export const PAYMENT_PROVIDER_IMPLEMENTATIONS = [
  CodPaymentProvider,
  ManualPaymentProvider,
  StripePaymentProvider,
] as const;
```

Each class carries two static fields:

- `providerId`: the value stored in `PaymentMethod.provider`. The admin allow-list and `REGISTERED_PAYMENT_PROVIDER_IDS` derive from it.
- `offeredAtCheckout`: whether the storefront may list a method of this provider. `CHECKOUT_PAYMENT_PROVIDER_IDS` filters on it, and `STOREFRONT_PAYMENT_PROVIDERS` in `payment-methods.service.ts` is that list. Start with `false`.

```ts
@Injectable()
export class StripePaymentProvider implements PaymentProvider<StripeConfig> {
  static readonly providerId = 'stripe' as const;
  /** No storefront step collects the card yet, so checkout must not offer it. */
  static readonly offeredAtCheckout = false;
  readonly id = StripePaymentProvider.providerId;
  readonly configSchema = stripeConfigSchema;
```

### 3. The gateway holds the config

`PaymentGatewayService` resolves a method code to `{ provider, config }`, parses `config` through `provider.configSchema`, and calls the provider. The config never leaves the service. Callers pass a method code:

- `openSession(code, ...)` only opens on a live method row.
- `capture`, `refund`, `cancel`, `authorize` and `providerIdFor` still resolve an inactive or soft-deleted method, so an existing order can always be settled.
- `parseWebhook(providerId, headers, rawBody)` tries every method row of that provider in `sortOrder`, deleted rows included, and returns the event with the codes of the methods whose config verified it.

### 4. Secrets from env

Secrets come from env through `ConfigService`, never from the request or a hardcoded value. The Stripe example reads `STRIPE_API_KEY` and `STRIPE_WEBHOOK_SECRET`, which the setup stepper prompts and writes:

```ts
  constructor(config: ConfigService) {
    const apiKey = config.get<string>('STRIPE_API_KEY');
    this.client = apiKey ? new Stripe(apiKey, { timeout: STRIPE_TIMEOUT_MS }) : undefined;
    this.webhookSecret = config.get<string>('STRIPE_WEBHOOK_SECRET') || undefined;
  }
```

- Add your prompts to `tools/setup/src/steps/payments.ts` and the keys to `compose-env.ts`.
- Without a key the app still boots, and every call answers 503 `PAYMENT_PROVIDER_UNAVAILABLE`.
- A per-method setting that is not a secret goes in the `config` blob and in `configSchema`. If a secret must live there, name it `apiKey`, `webhookSecret`, `clientSecret`, `privateKey` or `signingSecret`, so every admin read masks it as `***`.

### 5. Calling the remote API

The Stripe example shows the rules a remote provider follows:

- A timeout on every call (`STRIPE_TIMEOUT_MS`, 5 s).
- A circuit breaker from `providers/circuit-breaker.ts` that counts only connection and server errors. After `STRIPE_FAILURE_THRESHOLD` failures it stays open for `STRIPE_COOLDOWN_MS`. An outage or an open circuit answers 503 `PAYMENT_PROVIDER_UNAVAILABLE`.
- Any other provider error answers `PAYMENT_PROVIDER_REJECTED` with the provider's code.
- Every response is parsed with Zod. A shape you did not expect is rejected as `invalid_response`, never trusted.
- `idempotencyKey` is forwarded on capture, cancel and refund, so a retried admin action does not move money twice. A refund is keyed by the order, its status and the amount, not the request, so a second request key cannot refund twice. `createSession` sends `checkout-session:<orderId>`, so a retried order create does not open a second intent.
- Amounts go out in integer minor units from `currencyEntry(code).decimalPlaces`. A currency the catalogue does not know is refused as `unsupported_currency`, never guessed. An amount finer than the currency allows is refused as `amount_precision`, never rounded.
- A status outside the allowed set is refused with `PAYMENT_TRANSITION_NOT_ALLOWED` before any remote call.

### 6. Refunds

`OrdersService` computes the refund, not the provider. It nets the refund amount of processed returns off the order total and passes the rest as both `amount` and `refundableAmount`. When nothing is left it refuses with `ORDER_NOTHING_TO_REFUND` before calling the gateway. A provider still refuses a zero, a negative amount or more than `refundableAmount`, and answers `REFUNDED` when the amount covers what is left, `PARTIALLY_REFUNDED` otherwise.

### 7. Webhooks

`POST /v1/webhooks/payments/:providerId` in `apps/api/src/modules/orders/payment-webhook.controller.ts` is `@Public()` (the signature is the auth) and `@RateLimit.Skip()`. `req.rawBody` is captured in `apps/api/src/main.ts` before the JSON parser runs, and `parseWebhook` must verify over those exact bytes.

`PaymentWebhookService` verifies, dedups, applies, then records:

```ts
    const { event, methodCodes } = await this.paymentGateway.parseWebhook(
      providerId,
      headers,
      rawBody,
    );
    const dedupKey = `payments:${providerId}`;

    if (await this.processedWebhooks.isProcessed(dedupKey, event.eventId)) {
      return { ok: true, replay: true };
    }

    await this.orders.applyPaymentWebhookEvent(providerId, event, methodCodes);
```

- A missing or bad signature answers `PAYMENT_WEBHOOK_SIGNATURE_INVALID`. An event type you do not map answers `PAYMENT_WEBHOOK_UNSUPPORTED`, a 400 the provider keeps retrying, so subscribe the provider endpoint only to the event types you map.
- Two deliveries that race to the same status are fine: the second sees the status already landed and answers 200. A race to a different status answers `PAYMENT_TRANSITION_NOT_ALLOWED`.
- The order the event names must use one of the method codes whose secret verified it. A soft-deleted method's secret cannot move another method's orders.
- `ProcessedWebhook` has `@@unique([provider, externalEventId])`. `recordInboundEvent` runs after the apply, so a failed apply stays retryable, and a replay answers 200 with `replay: true` so the provider stops retrying.

The Stripe example maps:

- `payment_intent.amount_capturable_updated` to `AUTHORIZED`.
- `payment_intent.succeeded` to `CAPTURED`.
- `payment_intent.payment_failed` to `PENDING`. A failed attempt is not final: the intent goes back to `requires_payment_method` and the customer can try again. Map a retryable failure to a terminal status and the order can never be paid.
- `payment_intent.canceled` to `CANCELLED`.
- `charge.refunded` to `REFUNDED` when the whole charge is refunded, `PARTIALLY_REFUNDED` otherwise.

### 8. Offer it at checkout, last

Set `offeredAtCheckout = true` only once the storefront has a step that completes the payment, keyed on the `clientSecret` or `redirectUrl` the session returned. Until then the admin can create the method, but `GET /v1/checkout/settings` never lists it and order create refuses it.

Order create reads the enabled set itself rather than trusting the client. No method enabled is `ORDER_PAYMENT_METHOD_UNAVAILABLE`, an unknown or disabled code is `ORDER_PAYMENT_METHOD_INVALID`. The create is idempotent: `IdempotencyKeyPipe` requires an `X-Idempotency-Key` UUID v4, Redis keeps it 24 hours, a different body is 409 `IDEMPOTENCY_KEY_CONFLICT`, a different caller 403 `IDEMPOTENCY_KEY_FORBIDDEN`, and a failure calls `abortRequest` so the client can retry with the same key.

## Tests to run

```bash
npx nx test api
npm run test:e2e
npx nx e2e storefront-e2e
```

- Add a harness to `HARNESSES` in `payment-provider.conformance.spec.ts`. The suite checks the id, refuses every status outside the allowed set without a remote call, checks capture, cancel, full and partial refunds, refuses an over-refund, a zero and a negative amount, checks that the idempotency key is forwarded, and expects a 4xx on an unsigned webhook.
- Write a provider spec beside it for what is only yours: the event mapping, the minor units, the outage handling. `stripe-payment.provider.spec.ts` is the model.
- `npm run test:e2e` runs `apps/api/test/order-payments.e2e-spec.ts` (capture, refund, cancel and the Stripe webhook replay dedup) and `test/e2e/checkout-settings.e2e-spec.ts` (a method not offered at checkout never reaches the public list, and a planted secret never appears on the wire).
- `npx nx e2e storefront-e2e` runs the checkout journeys once the provider is offered.

## Gotchas

- Flipping `offeredAtCheckout` before the storefront step exists produces orders nobody can pay.
- An empty enabled set refuses every order. Keep `cod` or `manual` active until the new path is proven. The `cod` seed is create-only, so a deploy does not re-enable a row the operator turned off.
- A PATCH that sends `***` back keeps the stored secret, `null` deletes the key, anything else overwrites. Never log the `config` blob.
- The idempotency cache replays the serialized order create response for 24 hours. A field you add to it is in the replay too.
- `ProcessedWebhook` rows are never deleted. No retention job exists in `apps/api/src`.
- The env keys are shared by every method row of the provider. Two Stripe rows with different accounts need the keys moved into `configSchema`.
