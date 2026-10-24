import { currencyEntry } from '@common/constants/currencies.constants';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus, Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { z } from 'zod';
import { PaymentProviderRejectedException } from '../payment-provider-rejected.exception';
import { PaymentProviderUnavailableException } from '../payment-provider-unavailable.exception';
import { PaymentTransitionNotAllowedException } from '../payment-transition-not-allowed.exception';
import { PaymentWebhookSignatureInvalidException } from '../payment-webhook-signature-invalid.exception';
import { PaymentWebhookUnsupportedException } from '../payment-webhook-unsupported.exception';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';
import type {
  PaymentCaptureInput,
  PaymentMutationInput,
  PaymentOperationInput,
  PaymentProvider,
  PaymentProviderResult,
  PaymentRefundInput,
  PaymentSessionInput,
  PaymentWebhookEvent,
  PaymentWebhookInput,
} from './payment-provider.interface';

export const STRIPE_TIMEOUT_MS = 5000;
export const STRIPE_FAILURE_THRESHOLD = 5;
export const STRIPE_COOLDOWN_MS = 30_000;

const stripeConfigSchema = z.object({});
type StripeConfig = z.infer<typeof stripeConfigSchema>;

const intentSchema = z.object({
  id: z.string(),
  status: z.string(),
  client_secret: z.string().nullish(),
});
const refundSchema = z.object({ status: z.string().nullish() });
const intentEventSchema = z.object({ id: z.string() });
const chargeEventSchema = z.object({
  payment_intent: z.string(),
  amount: z.number().int(),
  amount_refunded: z.number().int(),
});

const INTENT_EVENTS: Record<string, PaymentStatus> = {
  'payment_intent.amount_capturable_updated': PaymentStatus.AUTHORIZED,
  'payment_intent.succeeded': PaymentStatus.CAPTURED,
  // A failed attempt is retryable: the intent goes back to requires_payment_method.
  'payment_intent.payment_failed': PaymentStatus.PENDING,
  'payment_intent.canceled': PaymentStatus.CANCELLED,
};

/**
 * Example card provider on Stripe Payment Intents with manual capture. The
 * API key and the webhook signing secret come from env (STRIPE_API_KEY,
 * STRIPE_WEBHOOK_SECRET), so every stripe method row shares them. Without a
 * key the app still boots and every call answers 503.
 */
@Injectable()
export class StripePaymentProvider implements PaymentProvider<StripeConfig> {
  static readonly providerId = 'stripe' as const;
  /** No storefront step collects the card yet, so checkout must not offer it. */
  static readonly offeredAtCheckout = false;
  readonly id = StripePaymentProvider.providerId;
  readonly configSchema = stripeConfigSchema;

  private readonly client: Stripe | undefined;
  private readonly webhookSecret: string | undefined;
  private readonly breaker = new CircuitBreaker({
    threshold: STRIPE_FAILURE_THRESHOLD,
    cooldownMs: STRIPE_COOLDOWN_MS,
    isFailure: (error) => isOutage(error),
  });

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('STRIPE_API_KEY');
    this.client = apiKey ? new Stripe(apiKey, { timeout: STRIPE_TIMEOUT_MS }) : undefined;
    this.webhookSecret = config.get<string>('STRIPE_WEBHOOK_SECRET') || undefined;
  }

  async createSession(input: PaymentSessionInput<StripeConfig>): Promise<PaymentProviderResult> {
    const client = this.requireClient();
    const amount = this.toMinorUnits(input.amount, input.currencyCode);
    const intent = await this.call(intentSchema, () =>
      client.paymentIntents.create(
        {
          amount,
          currency: input.currencyCode.toLowerCase(),
          capture_method: 'manual',
          metadata: { orderId: input.orderId },
          automatic_payment_methods: { enabled: true },
        },
        { idempotencyKey: `checkout-session:${input.orderId}` },
      ),
    );
    const result: PaymentProviderResult = {
      reference: intent.id,
      status: intentStatus(intent.status),
    };
    if (intent.client_secret) result.clientSecret = intent.client_secret;
    return result;
  }

  async authorize(input: PaymentOperationInput<StripeConfig>): Promise<PaymentProviderResult> {
    const client = this.requireClient();
    this.assertFrom(input, 'authorize', [PaymentStatus.PENDING]);
    const intent = await this.call(intentSchema, () =>
      client.paymentIntents.retrieve(input.reference),
    );
    if (intentStatus(intent.status) !== PaymentStatus.AUTHORIZED) {
      throw new PaymentTransitionNotAllowedException(this.id, input.status, 'authorize');
    }
    return { reference: input.reference, status: PaymentStatus.AUTHORIZED };
  }

  async capture(input: PaymentCaptureInput<StripeConfig>): Promise<PaymentProviderResult> {
    const client = this.requireClient();
    this.assertFrom(input, 'capture', [PaymentStatus.AUTHORIZED]);
    const amount = this.toMinorUnits(input.amount, input.currencyCode);
    const intent = await this.call(intentSchema, () =>
      client.paymentIntents.capture(
        input.reference,
        { amount_to_capture: amount },
        { idempotencyKey: input.idempotencyKey },
      ),
    );
    return { reference: input.reference, status: intentStatus(intent.status) };
  }

  async cancel(input: PaymentMutationInput<StripeConfig>): Promise<PaymentProviderResult> {
    const client = this.requireClient();
    this.assertFrom(input, 'cancel', [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED]);
    const intent = await this.call(intentSchema, () =>
      client.paymentIntents.cancel(input.reference, {}, { idempotencyKey: input.idempotencyKey }),
    );
    return { reference: input.reference, status: intentStatus(intent.status) };
  }

  async refund(input: PaymentRefundInput<StripeConfig>): Promise<PaymentProviderResult> {
    const client = this.requireClient();
    this.assertFrom(input, 'refund', [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED]);
    if (input.amount.lte(0) || input.amount.gt(input.refundableAmount)) {
      throw new PaymentTransitionNotAllowedException(this.id, input.status, 'refund');
    }
    const amount = this.toMinorUnits(input.amount, input.currencyCode);
    const refund = await this.call(refundSchema, () =>
      client.refunds.create(
        { payment_intent: input.reference, amount },
        { idempotencyKey: input.idempotencyKey },
      ),
    );
    if (refund.status === 'failed' || refund.status === 'canceled') {
      throw new PaymentProviderRejectedException(this.id, `refund_${refund.status}`);
    }
    const status = input.amount.gte(input.refundableAmount)
      ? PaymentStatus.REFUNDED
      : PaymentStatus.PARTIALLY_REFUNDED;
    return { reference: input.reference, status };
  }

  async getStatus(input: PaymentOperationInput<StripeConfig>): Promise<PaymentProviderResult> {
    const client = this.requireClient();
    const intent = await this.call(intentSchema, () =>
      client.paymentIntents.retrieve(input.reference),
    );
    const status = intentStatus(intent.status);
    const refunded =
      input.status === PaymentStatus.REFUNDED || input.status === PaymentStatus.PARTIALLY_REFUNDED;
    return {
      reference: input.reference,
      status: refunded && status === PaymentStatus.CAPTURED ? input.status : status,
    };
  }

  async parseWebhook(input: PaymentWebhookInput<StripeConfig>): Promise<PaymentWebhookEvent> {
    if (!this.webhookSecret) throw new PaymentProviderUnavailableException(this.id);
    const signature = input.headers['stripe-signature'];
    if (typeof signature !== 'string') throw new PaymentWebhookSignatureInvalidException(this.id);

    let event: Stripe.Event;
    try {
      event = Stripe.webhooks.constructEvent(input.rawBody, signature, this.webhookSecret);
    } catch {
      throw new PaymentWebhookSignatureInvalidException(this.id);
    }

    const object = event.data.object;
    const intentEventStatus = INTENT_EVENTS[event.type];
    if (intentEventStatus) {
      const intent = this.parse(intentEventSchema, object);
      return { eventId: event.id, reference: intent.id, status: intentEventStatus };
    }
    if (event.type === 'charge.refunded') {
      const charge = this.parse(chargeEventSchema, object);
      const status =
        charge.amount_refunded >= charge.amount
          ? PaymentStatus.REFUNDED
          : PaymentStatus.PARTIALLY_REFUNDED;
      return { eventId: event.id, reference: charge.payment_intent, status };
    }
    throw new PaymentWebhookUnsupportedException(this.id);
  }

  private requireClient(): Stripe {
    if (!this.client) throw new PaymentProviderUnavailableException(this.id);
    return this.client;
  }

  private async call<T>(schema: z.ZodType<T>, fn: () => Promise<unknown>): Promise<T> {
    let response: unknown;
    try {
      response = await this.breaker.run(fn);
    } catch (error) {
      if (error instanceof CircuitOpenError || isOutage(error)) {
        throw new PaymentProviderUnavailableException(this.id);
      }
      if (error instanceof Stripe.errors.StripeError) {
        throw new PaymentProviderRejectedException(this.id, error.code ?? error.type);
      }
      throw error;
    }
    return this.parse(schema, response);
  }

  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new PaymentProviderRejectedException(this.id, 'invalid_response');
    return parsed.data;
  }

  /**
   * Stripe takes integer minor units. An unknown currency is refused rather than
   * guessed, and an amount finer than the currency allows is refused, never rounded.
   */
  private toMinorUnits(amount: Prisma.Decimal, currencyCode: string): number {
    const entry = currencyEntry(currencyCode);
    if (!entry) throw new PaymentProviderRejectedException(this.id, 'unsupported_currency');
    const places = entry.decimalPlaces;
    const minor = amount.mul(new Prisma.Decimal(10).pow(places));
    if (!minor.isInteger()) throw new PaymentProviderRejectedException(this.id, 'amount_precision');
    return minor.toNumber();
  }

  private assertFrom(
    input: PaymentOperationInput<StripeConfig>,
    action: string,
    allowed: PaymentStatus[],
  ): void {
    if (!allowed.includes(input.status)) {
      throw new PaymentTransitionNotAllowedException(this.id, input.status, action);
    }
  }
}

function isOutage(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeConnectionError ||
    error instanceof Stripe.errors.StripeAPIError
  );
}

function intentStatus(status: string): PaymentStatus {
  switch (status) {
    case 'requires_capture':
      return PaymentStatus.AUTHORIZED;
    case 'succeeded':
      return PaymentStatus.CAPTURED;
    case 'canceled':
      return PaymentStatus.CANCELLED;
    default:
      return PaymentStatus.PENDING;
  }
}
