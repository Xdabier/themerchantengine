import { PaymentStatus, Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { PaymentProviderRejectedException } from '../payment-provider-rejected.exception';
import { PaymentProviderUnavailableException } from '../payment-provider-unavailable.exception';
import { PaymentTransitionNotAllowedException } from '../payment-transition-not-allowed.exception';
import { PaymentWebhookSignatureInvalidException } from '../payment-webhook-signature-invalid.exception';
import { PaymentWebhookUnsupportedException } from '../payment-webhook-unsupported.exception';
import { STRIPE_FAILURE_THRESHOLD, StripePaymentProvider } from './stripe-payment.provider';

const API_KEY = 'sk_test_example';
const WEBHOOK_SECRET = 'whsec_example';

function makeConfig(values: Record<string, string>) {
  return { get: jest.fn((k: string) => values[k]) } as never;
}

function makeProvider(values = { STRIPE_API_KEY: API_KEY, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }) {
  const provider = new StripePaymentProvider(makeConfig(values));
  const client = (provider as unknown as { client: Stripe | undefined }).client;
  return { provider, client };
}

function intent(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'pi_123',
    object: 'payment_intent',
    status,
    client_secret: 'pi_123_secret',
    ...extra,
  };
}

const base = { reference: 'pi_123', config: {}, idempotencyKey: 'op-key' };

describe('StripePaymentProvider', () => {
  it('is labelled stripe and reads an empty config', () => {
    const { provider } = makeProvider();
    expect(provider.id).toBe('stripe');
    expect(StripePaymentProvider.providerId).toBe('stripe');
    expect(provider.configSchema.parse({})).toEqual({});
  });

  it('builds the SDK client with a 5 s timeout', () => {
    const { client } = makeProvider();
    expect(client?.getApiField('timeout')).toBe(5000);
  });

  describe('without STRIPE_API_KEY', () => {
    it('boots and refuses every call as unavailable', async () => {
      const { provider } = makeProvider({ STRIPE_API_KEY: '', STRIPE_WEBHOOK_SECRET: '' });
      await expect(
        provider.createSession({
          orderId: 'o1',
          amount: new Prisma.Decimal('10.00'),
          currencyCode: 'EUR',
          config: {},
        }),
      ).rejects.toBeInstanceOf(PaymentProviderUnavailableException);
      await expect(
        provider.getStatus({ ...base, status: PaymentStatus.PENDING }),
      ).rejects.toBeInstanceOf(PaymentProviderUnavailableException);
    });
  });

  describe('createSession', () => {
    it('creates a manual-capture PaymentIntent in minor units', async () => {
      const { provider, client } = makeProvider();
      const create = jest
        .spyOn(client!.paymentIntents, 'create')
        .mockResolvedValue(intent('requires_payment_method') as never);

      const result = await provider.createSession({
        orderId: 'o1',
        amount: new Prisma.Decimal('125.500'),
        currencyCode: 'KWD',
        config: {},
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 125500,
          currency: 'kwd',
          capture_method: 'manual',
          metadata: { orderId: 'o1' },
        }),
        { idempotencyKey: 'checkout-session:o1' },
      );
      expect(result).toEqual({
        reference: 'pi_123',
        status: PaymentStatus.PENDING,
        clientSecret: 'pi_123_secret',
      });
    });

    it('uses two decimals for a two-decimal currency', async () => {
      const { provider, client } = makeProvider();
      const create = jest
        .spyOn(client!.paymentIntents, 'create')
        .mockResolvedValue(intent('requires_payment_method') as never);

      await provider.createSession({
        orderId: 'o1',
        amount: new Prisma.Decimal('10.50'),
        currencyCode: 'EUR',
        config: {},
      });

      expect(create.mock.calls[0][0]).toMatchObject({ amount: 1050, currency: 'eur' });
    });

    it('refuses an unknown currency without a call, never guessing its decimals', async () => {
      const { provider, client } = makeProvider();
      const create = jest.spyOn(client!.paymentIntents, 'create');

      await expect(
        provider.createSession({
          orderId: 'o1',
          amount: new Prisma.Decimal('7.25'),
          currencyCode: 'XTS',
          config: {},
        }),
      ).rejects.toMatchObject({
        response: {
          error: { details: expect.objectContaining({ reason: 'unsupported_currency' }) },
        },
      });
      expect(create).not.toHaveBeenCalled();
    });

    it('refuses an amount finer than the currency allows, without a call', async () => {
      const { provider, client } = makeProvider();
      const create = jest.spyOn(client!.paymentIntents, 'create');
      await expect(
        provider.createSession({
          orderId: 'o1',
          amount: new Prisma.Decimal('10.555'),
          currencyCode: 'EUR',
          config: {},
        }),
      ).rejects.toBeInstanceOf(PaymentProviderRejectedException);
      expect(create).not.toHaveBeenCalled();
    });

    it('refuses a response that does not match the schema', async () => {
      const { provider, client } = makeProvider();
      jest.spyOn(client!.paymentIntents, 'create').mockResolvedValue({ id: 42 } as never);
      await expect(
        provider.createSession({
          orderId: 'o1',
          amount: new Prisma.Decimal('10.00'),
          currencyCode: 'EUR',
          config: {},
        }),
      ).rejects.toBeInstanceOf(PaymentProviderRejectedException);
    });
  });

  describe('authorize', () => {
    it('confirms a held PaymentIntent as AUTHORIZED', async () => {
      const { provider, client } = makeProvider();
      jest
        .spyOn(client!.paymentIntents, 'retrieve')
        .mockResolvedValue(intent('requires_capture') as never);
      await expect(provider.authorize({ ...base, status: PaymentStatus.PENDING })).resolves.toEqual(
        { reference: 'pi_123', status: PaymentStatus.AUTHORIZED },
      );
    });

    it('refuses when Stripe holds no funds yet', async () => {
      const { provider, client } = makeProvider();
      jest
        .spyOn(client!.paymentIntents, 'retrieve')
        .mockResolvedValue(intent('requires_payment_method') as never);
      await expect(
        provider.authorize({ ...base, status: PaymentStatus.PENDING }),
      ).rejects.toBeInstanceOf(PaymentTransitionNotAllowedException);
    });
  });

  describe('capture', () => {
    it('captures the amount with the idempotency key', async () => {
      const { provider, client } = makeProvider();
      const capture = jest
        .spyOn(client!.paymentIntents, 'capture')
        .mockResolvedValue(intent('succeeded') as never);

      const result = await provider.capture({
        ...base,
        status: PaymentStatus.AUTHORIZED,
        amount: new Prisma.Decimal('125.500'),
        currencyCode: 'KWD',
      });

      expect(capture).toHaveBeenCalledWith(
        'pi_123',
        { amount_to_capture: 125500 },
        { idempotencyKey: 'op-key' },
      );
      expect(result).toEqual({ reference: 'pi_123', status: PaymentStatus.CAPTURED });
    });

    it('refuses from PENDING without a call', async () => {
      const { provider, client } = makeProvider();
      const capture = jest.spyOn(client!.paymentIntents, 'capture');
      await expect(
        provider.capture({
          ...base,
          status: PaymentStatus.PENDING,
          amount: new Prisma.Decimal('1.00'),
          currencyCode: 'KWD',
        }),
      ).rejects.toBeInstanceOf(PaymentTransitionNotAllowedException);
      expect(capture).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it.each([PaymentStatus.PENDING, PaymentStatus.AUTHORIZED])(
      'cancels from %s with the idempotency key',
      async (status) => {
        const { provider, client } = makeProvider();
        const cancel = jest
          .spyOn(client!.paymentIntents, 'cancel')
          .mockResolvedValue(intent('canceled') as never);
        await expect(provider.cancel({ ...base, status })).resolves.toEqual({
          reference: 'pi_123',
          status: PaymentStatus.CANCELLED,
        });
        expect(cancel).toHaveBeenCalledWith('pi_123', {}, { idempotencyKey: 'op-key' });
      },
    );

    it('refuses from CAPTURED', async () => {
      const { provider } = makeProvider();
      await expect(
        provider.cancel({ ...base, status: PaymentStatus.CAPTURED }),
      ).rejects.toBeInstanceOf(PaymentTransitionNotAllowedException);
    });
  });

  describe('refund', () => {
    const refundInput = (amount: string) => ({
      ...base,
      status: PaymentStatus.CAPTURED,
      amount: new Prisma.Decimal(amount),
      currencyCode: 'EUR',
      refundableAmount: new Prisma.Decimal('100.00'),
    });

    it('refunds part of the payment with the idempotency key', async () => {
      const { provider, client } = makeProvider();
      const create = jest
        .spyOn(client!.refunds, 'create')
        .mockResolvedValue({ id: 're_1', object: 'refund', status: 'succeeded' } as never);

      await expect(provider.refund(refundInput('40.00'))).resolves.toEqual({
        reference: 'pi_123',
        status: PaymentStatus.PARTIALLY_REFUNDED,
      });
      expect(create).toHaveBeenCalledWith(
        { payment_intent: 'pi_123', amount: 4000 },
        { idempotencyKey: 'op-key' },
      );
    });

    it('marks a refund of everything left as REFUNDED', async () => {
      const { provider, client } = makeProvider();
      jest
        .spyOn(client!.refunds, 'create')
        .mockResolvedValue({ id: 're_1', object: 'refund', status: 'pending' } as never);
      await expect(provider.refund(refundInput('100.00'))).resolves.toEqual({
        reference: 'pi_123',
        status: PaymentStatus.REFUNDED,
      });
    });

    it.each(['0', '100.01'])('refuses %s without a call', async (amount) => {
      const { provider, client } = makeProvider();
      const create = jest.spyOn(client!.refunds, 'create');
      await expect(provider.refund(refundInput(amount))).rejects.toBeInstanceOf(
        PaymentTransitionNotAllowedException,
      );
      expect(create).not.toHaveBeenCalled();
    });

    it('treats a failed refund as rejected', async () => {
      const { provider, client } = makeProvider();
      jest
        .spyOn(client!.refunds, 'create')
        .mockResolvedValue({ id: 're_1', object: 'refund', status: 'failed' } as never);
      await expect(provider.refund(refundInput('40.00'))).rejects.toBeInstanceOf(
        PaymentProviderRejectedException,
      );
    });
  });

  describe('getStatus', () => {
    it.each([
      ['requires_action', PaymentStatus.PENDING, PaymentStatus.PENDING],
      ['requires_capture', PaymentStatus.PENDING, PaymentStatus.AUTHORIZED],
      ['succeeded', PaymentStatus.AUTHORIZED, PaymentStatus.CAPTURED],
      ['canceled', PaymentStatus.PENDING, PaymentStatus.CANCELLED],
      ['succeeded', PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.PARTIALLY_REFUNDED],
    ])('maps %s from %s to %s', async (stripeStatus, status, expected) => {
      const { provider, client } = makeProvider();
      jest
        .spyOn(client!.paymentIntents, 'retrieve')
        .mockResolvedValue(intent(stripeStatus) as never);
      await expect(provider.getStatus({ ...base, status })).resolves.toEqual({
        reference: 'pi_123',
        status: expected,
      });
    });
  });

  describe('SDK errors', () => {
    it('maps a connection error to unavailable and opens the breaker', async () => {
      const { provider, client } = makeProvider();
      const retrieve = jest
        .spyOn(client!.paymentIntents, 'retrieve')
        .mockRejectedValue(new Stripe.errors.StripeConnectionError({ message: 'down' }));
      const input = { ...base, status: PaymentStatus.PENDING };

      for (let i = 0; i < STRIPE_FAILURE_THRESHOLD; i += 1) {
        await expect(provider.getStatus(input)).rejects.toBeInstanceOf(
          PaymentProviderUnavailableException,
        );
      }
      await expect(provider.getStatus(input)).rejects.toBeInstanceOf(
        PaymentProviderUnavailableException,
      );
      expect(retrieve).toHaveBeenCalledTimes(STRIPE_FAILURE_THRESHOLD);
    });

    it('maps a card error to rejected without opening the breaker', async () => {
      const { provider, client } = makeProvider();
      const retrieve = jest
        .spyOn(client!.paymentIntents, 'retrieve')
        .mockRejectedValue(
          new Stripe.errors.StripeCardError({ message: 'declined', code: 'card_declined' }),
        );
      const input = { ...base, status: PaymentStatus.PENDING };

      for (let i = 0; i <= STRIPE_FAILURE_THRESHOLD; i += 1) {
        await expect(provider.getStatus(input)).rejects.toBeInstanceOf(
          PaymentProviderRejectedException,
        );
      }
      expect(retrieve).toHaveBeenCalledTimes(STRIPE_FAILURE_THRESHOLD + 1);
    });
  });

  describe('parseWebhook', () => {
    function signed(event: Record<string, unknown>, secret = WEBHOOK_SECRET) {
      const payload = JSON.stringify(event);
      const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
      return { headers: { 'stripe-signature': header }, rawBody: Buffer.from(payload), config: {} };
    }

    function event(type: string, object: Record<string, unknown>) {
      return { id: 'evt_1', object: 'event', type, data: { object } };
    }

    it.each([
      ['payment_intent.amount_capturable_updated', PaymentStatus.AUTHORIZED],
      ['payment_intent.succeeded', PaymentStatus.CAPTURED],
      // A failed attempt is retryable: the intent goes back to requires_payment_method.
      ['payment_intent.payment_failed', PaymentStatus.PENDING],
      ['payment_intent.canceled', PaymentStatus.CANCELLED],
    ])('maps %s to %s', async (type, status) => {
      const { provider } = makeProvider();
      await expect(
        provider.parseWebhook(signed(event(type, { id: 'pi_123', object: 'payment_intent' }))),
      ).resolves.toEqual({ eventId: 'evt_1', reference: 'pi_123', status });
    });

    it.each([
      [4000, PaymentStatus.PARTIALLY_REFUNDED],
      [10000, PaymentStatus.REFUNDED],
    ])('maps charge.refunded of %i to %s on the PaymentIntent', async (refunded, status) => {
      const { provider } = makeProvider();
      const charge = {
        id: 'ch_1',
        object: 'charge',
        payment_intent: 'pi_123',
        amount: 10000,
        amount_refunded: refunded,
      };
      await expect(
        provider.parseWebhook(signed(event('charge.refunded', charge))),
      ).resolves.toEqual({ eventId: 'evt_1', reference: 'pi_123', status });
    });

    it('refuses a payload signed with another secret', async () => {
      const { provider } = makeProvider();
      await expect(
        provider.parseWebhook(
          signed(event('payment_intent.succeeded', { id: 'pi_123' }), 'whsec_other'),
        ),
      ).rejects.toBeInstanceOf(PaymentWebhookSignatureInvalidException);
    });

    it('refuses a missing or repeated signature header', async () => {
      const { provider } = makeProvider();
      const input = signed(event('payment_intent.succeeded', { id: 'pi_123' }));
      const header = input.headers['stripe-signature'];
      await expect(provider.parseWebhook({ ...input, headers: {} })).rejects.toBeInstanceOf(
        PaymentWebhookSignatureInvalidException,
      );
      await expect(
        provider.parseWebhook({ ...input, headers: { 'stripe-signature': [header, header] } }),
      ).rejects.toBeInstanceOf(PaymentWebhookSignatureInvalidException);
    });

    it('refuses an event type it does not map', async () => {
      const { provider } = makeProvider();
      await expect(
        provider.parseWebhook(signed(event('customer.created', { id: 'cus_1' }))),
      ).rejects.toBeInstanceOf(PaymentWebhookUnsupportedException);
    });

    it('refuses a mapped event whose object does not match the schema', async () => {
      const { provider } = makeProvider();
      await expect(
        provider.parseWebhook(signed(event('payment_intent.succeeded', { id: 42 }))),
      ).rejects.toBeInstanceOf(PaymentProviderRejectedException);
    });

    it('is unavailable without STRIPE_WEBHOOK_SECRET', async () => {
      const { provider } = makeProvider({ STRIPE_API_KEY: API_KEY, STRIPE_WEBHOOK_SECRET: '' });
      await expect(
        provider.parseWebhook(signed(event('payment_intent.succeeded', { id: 'pi_123' }))),
      ).rejects.toBeInstanceOf(PaymentProviderUnavailableException);
    });
  });
});
