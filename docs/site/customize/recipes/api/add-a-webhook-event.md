---
title: Add a webhook event
description: "Add an outbound webhook event type: the catalogue, the internal event a module emits, the listener bridge, the BullMQ dispatcher with its globally unique eventId, the signed delivery and its retry log, the admin subscription screen, and the URL validations."
primaryQuery: add an outbound webhook event nestjs bullmq ecommerce
primaryQueryNote: none
updated: 2026-09-09
schema: HowTo
---

## When you need this

An external system needs to know when something happens in the store: a warehouse on `order.confirmed`, an accounting tool on a refund, your own service on a new event you are adding. A subscription is an HTTPS URL, a list of event types and an HMAC secret; each event becomes one delivery per subscription, signed, retried on a fixed schedule and logged. This page adds an event type from the catalogue to the subscriber's inbox. You end with a type operators can subscribe to in the admin, deliveries they can read back, and a signature the receiver can verify.

## Files you touch

- `apps/api/src/modules/webhooks/webhooks.constants.ts`: the event catalogue, the queue name, the retry schedule and the signature header.
- `apps/api/src/modules/orders/orders.constants.ts` and `apps/api/src/modules/orders/orders.service.ts`: how a module names and emits an internal event.
- `apps/api/src/modules/webhooks/webhooks.listener.ts`: the bridge from the internal event bus to the dispatcher.
- `apps/api/src/modules/webhooks/webhooks.service.ts`: `dispatchEvent`, the delivery rows, retries and deactivation.
- `apps/api/src/modules/webhooks/processors/webhook-delivery.processor.ts`: the BullMQ worker that signs and POSTs.
- `apps/api/src/modules/webhooks/webhooks.utils.ts`: URL validation and HMAC signing.
- `apps/api/src/modules/webhooks/dto/create-webhook.dto.ts`: the subscription body.
- `libs/admin-services/src/webhooks/webhooks.schemas.ts` and `apps/admin/src/app/features/webhooks/webhook-create.page.ts`: the admin mirror of the catalogue and the subscription screen.

## The pattern

### 1. Add the type to the catalogue

`apps/api/src/modules/webhooks/webhooks.constants.ts`:

```ts
export const WEBHOOK_EVENT_TYPES = [
  'order.created',
  'order.confirmed',
  'order.status_changed',
  'order.cancelled',
  'order.shipped',
  'order.delivered',
  'product.created',
  'product.updated',
  'product.deleted',
  'inventory.low_stock',
  'inventory.out_of_stock',
  'inventory.restocked',
  'customer.created',
  'customer.updated',
  'cart.abandoned',
  'return.requested',
  'return.approved',
  'return.refunded',
  'review.submitted',
  'payment.received',
  'payment.refunded',
] as const;
```

That is the full list at `apps/api/src/modules/webhooks/webhooks.constants.ts:56-78`, 21 types. `CreateWebhookDto` validates `events` with `@IsEnum(WEBHOOK_EVENT_TYPES, { each: true })`, so a subscription can only name a catalogue type.

`apps/api/src/modules/webhooks/webhooks.service.spec.ts` pins the catalogue twice: an explicit `expected` array starting at line 375 and, at lines 396-398, `it('contains all 21 spec event types')` with `toHaveLength(21)`. Add the new type to the array and bump the count in the same change.

### 2. Emit the internal event from its module

The emitting module owns the event name. `apps/api/src/modules/orders/orders.constants.ts`:

```ts
export const ORDER_EVENTS = {
  CREATED: 'order.created',
  CONFIRMED: 'order.confirmed',
  STATUS_CHANGED: 'order.status_changed',
  CANCELLED: 'order.cancelled',
  SHIPPED: 'order.shipped',
  DELIVERED: 'order.delivered',
} as const;
```

`apps/api/src/modules/orders/orders.service.ts` emits after the transaction and the idempotency cache commit:

```ts
      this.events.emit(ORDER_EVENTS.CREATED, {
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId,
        total: orderTotal,
      });
```

The payload you emit is the `data` the subscriber receives. Keep it to ids and a few scalars; a subscriber fetches the rest.

### 3. Bridge it

`apps/api/src/modules/webhooks/webhooks.listener.ts` has one handler per catalogue type. It imports nothing from the emitting modules: its only imports are `@nestjs/common`, `@nestjs/event-emitter` and `WebhooksService`, and every `@OnEvent` argument is a string literal that must equal the value the emitting module's constant holds. `@OnEvent(ORDER_EVENTS.CREATED)` is not the pattern used there. The internal name and the wire name can differ:

```ts
  @OnEvent('order.created', { async: true })
  async onOrderCreated(data: unknown) {
    await this.dispatch('order.created', data);
  }

  @OnEvent('return.created', { async: true })
  async onReturnRequested(data: unknown) {
    await this.dispatch('return.requested', data);
  }

  private async dispatch(eventType: string, data: unknown): Promise<void> {
    try {
      await this.webhooksService.dispatchEvent(eventType, data);
    } catch (err) {
      this.logger.error(`dispatch failed for ${eventType}: ${(err as Error).message}`);
    }
  }
```

A dispatch failure is logged and never reaches the business transaction that emitted the event.

### 4. The dispatcher

`apps/api/src/modules/webhooks/webhooks.service.ts`:

```ts
  async dispatchEvent(eventType: string, data: unknown): Promise<void> {
    const subscriptions = await this.prisma.webhookSubscription.findMany({
      where: { isActive: true, events: { has: eventType } },
      select: { id: true },
    });
    if (subscriptions.length === 0) return;

    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();

    await Promise.all(
      subscriptions.map(async ({ id }) => {
        const delivery = await this.prisma.webhookDelivery.create({
          data: {
            subscriptionId: id,
            eventType,
            eventId,
            payload: { eventId, eventType, occurredAt, data, version: WEBHOOK_PAYLOAD_VERSION },
            attempt: 1,
          },
        });
        await this.queue.add(WEBHOOK_DELIVERY_JOB, { /* ... */ }, { attempts: 1 });
      }),
    );
  }
```

One `eventId` per event, shared by every subscription's delivery and by every retry of it, so a subscriber deduplicates on `eventId`. The queue is `webhook-delivery`; jobs are added with `attempts: 1` because retries are scheduled by hand to hit exact delays.

### 5. Delivery and signature

`apps/api/src/modules/webhooks/processors/webhook-delivery.processor.ts`:

```ts
    const body = JSON.stringify({ eventId, eventType, occurredAt, data, version: WEBHOOK_PAYLOAD_VERSION });
    const signature = signPayload(body, sub.secret);

        const response = await fetch(sub.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [WEBHOOK_SIGNATURE_HEADER]: signature,
            'X-Webhook-Event': eventType,
            'X-Webhook-EventId': eventId,
          },
          body,
          signal: controller.signal,
        });
```

`signPayload` in `apps/api/src/modules/webhooks/webhooks.utils.ts` is `HMAC-SHA256(secret, body)` as hex, sent in `X-Webhook-Signature`. The receiver recomputes it over the exact bytes of the request body. The request times out after ten seconds; any 2xx is a success.

### 6. Retries and the log

`apps/api/src/modules/webhooks/webhooks.constants.ts`:

```ts
export const RETRY_DELAYS_MS = [
  1 * 60 * 1_000,
  5 * 60 * 1_000,
  30 * 60 * 1_000,
  2 * 60 * 60 * 1_000,
  24 * 60 * 60 * 1_000,
] as const;
export const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_MS.length;
```

Each attempt is its own append-only `WebhookDelivery` row with `responseStatus`, `responseBody`, `succeededAt` or `failedAt`, and `nextRetryAt`. A success resets the subscription's `failureCount`; an exhausted sequence increments it, and the fifth consecutive one sets `isActive: false`. The processor skips a delivery whose subscription is inactive. `GET /v1/admin/webhooks/:id/deliveries` pages the log.

### 7. The URL rules

`apps/api/src/modules/webhooks/webhooks.utils.ts`:

```ts
  if (parsed.protocol !== 'https:') {
    throw new BadRequestException({
      error: { code: 'WEBHOOK_URL_NOT_HTTPS', message: 'Webhook URL must use the HTTPS scheme' },
    });
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new BadRequestException({
      error: {
        code: 'WEBHOOK_URL_INTERNAL_IP',
        message: 'Webhook URL must not target internal or loopback addresses',
      },
    });
  }
```

`isBlockedHostname` refuses the private IPv4 ranges, loopback, link-local, the IPv6 equivalents and `localhost`. `validateWebhookUrl` runs on create and on any update that carries a `url`.

### 8. The admin screen

`libs/admin-services/src/webhooks/webhooks.schemas.ts` holds a copy of the catalogue as a Zod enum, and the file says so:

```ts
/**
 * Event types mirror `apps/api/src/modules/webhooks/webhooks.constants.ts`.
 * Update this list when the backend catalog changes.
 */
export const webhookEventTypeSchema = z.enum([
```

`apps/admin/src/app/features/webhooks/webhook-create.page.ts` renders one checkbox per enum option, requires an `https://` URL client-side, and maps the three backend codes `WEBHOOK_URL_NOT_HTTPS`, `WEBHOOK_URL_INTERNAL_IP` and `INVALID_WEBHOOK_URL` onto the URL field. Every subscription route needs `settings:manage` to write and `settings:view` to read; there is no `webhooks` permission module.

## Tests to run

```bash
npx nx test api
npx nx lint api
npm run test:e2e
```

`npx nx test api` runs `webhooks.service.spec.ts` (with the 21-type catalogue pin from step 1) and `processed-webhook.service.spec.ts`. `npx nx lint api` lints `apps/api` and `test/`; no lint rule checks which module an event name comes from, so a listener literal that drifts from the emitter's constant is caught only by a test that emits the event. `npm run test:e2e` runs `apps/api/test/webhooks.e2e-spec.ts`: the HTTP and internal-IP refusals, the unknown-type refusal, the secret omitted from reads, the test delivery with its idempotency key and the delivery log.

## Gotchas

- The admin enum is a hand-maintained copy. A type added to the API and not to `webhooks.schemas.ts` cannot be ticked in the admin, and a subscription that already carries it fails the admin's read schema.
- `payment.received` and `payment.refunded` are in the catalogue and the listener, and no module emits them. Subscribing to them delivers nothing until a payment provider exists.
- The secret is returned once, on create. List and get responses omit it, and the DTO omits it from PATCH, so a lost secret means a new subscription.
- `POST /v1/admin/webhooks/:id/test` requires an `X-Idempotency-Key` and sends the first subscribed type with `{ test: true }`. Without the header it is a 400 `IDEMPOTENCY_KEY_REQUIRED`.
- Wire names and internal names differ where noted in the listener (`return.created` becomes `return.requested`, `review.created` becomes `review.submitted`). Subscribers register the wire name.
- `handleDeliveryExhausted` compares `failureCount` to a literal `5`, not to `MAX_CONSECUTIVE_FAILURES`. Both are five today; change both.
- A retry is a new row with the same `eventId`. A receiver that keys on delivery id instead of `eventId` processes the event again after every retry.
