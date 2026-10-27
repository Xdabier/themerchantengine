import { HttpException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { CodPaymentProvider } from './cod-payment.provider';
import { ManualPaymentProvider } from './manual-payment.provider';
import type { PaymentProvider } from './payment-provider.interface';
import { StripePaymentProvider } from './stripe-payment.provider';

/**
 * The contract every payment provider keeps, whatever moves the money. A new
 * provider adds one harness to `HARNESSES` and must pass every case below.
 *
 * - `captureFrom` and `cancelFrom` are the statuses the provider declares it
 *   can capture or cancel from. Refund is fixed by the contract: only from
 *   CAPTURED or PARTIALLY_REFUNDED.
 * - `stubSuccess` makes the remote side answer success; offline providers
 *   have no remote side.
 * - `idempotencyKeys` returns the key sent with every remote mutation so far.
 * - `remote` says the provider calls a remote side, so every mutation sends a key.
 */
interface ConformanceHarness {
  providerId: string;
  remote: boolean;
  captureFrom: PaymentStatus[];
  cancelFrom: PaymentStatus[];
  make(): {
    provider: PaymentProvider;
    stubSuccess(): void;
    idempotencyKeys(): string[];
  };
}

const REFUND_FROM: PaymentStatus[] = [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED];

function offlineHarness(
  Provider: typeof CodPaymentProvider | typeof ManualPaymentProvider,
): ConformanceHarness {
  return {
    providerId: Provider.providerId,
    remote: false,
    captureFrom: [PaymentStatus.PENDING],
    cancelFrom: [PaymentStatus.PENDING],
    make: () => ({
      provider: new Provider(),
      stubSuccess: () => undefined,
      idempotencyKeys: () => [],
    }),
  };
}

function stripeHarness(): ConformanceHarness {
  return {
    providerId: StripePaymentProvider.providerId,
    remote: true,
    captureFrom: [PaymentStatus.AUTHORIZED],
    cancelFrom: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED],
    make: () => {
      const values: Record<string, string> = {
        STRIPE_API_KEY: 'sk_test_example',
        STRIPE_WEBHOOK_SECRET: 'whsec_example',
      };
      const provider = new StripePaymentProvider({ get: (key: string) => values[key] } as never);
      const client = (provider as unknown as { client: Stripe }).client;
      const intent = (status: string) => ({ id: 'pi_123', object: 'payment_intent', status });
      const capture = jest.spyOn(client.paymentIntents, 'capture');
      const cancel = jest.spyOn(client.paymentIntents, 'cancel');
      const refund = jest.spyOn(client.refunds, 'create');
      for (const spy of [capture, cancel, refund]) {
        spy.mockRejectedValue(new Error('remote call not expected'));
      }
      return {
        provider,
        stubSuccess: () => {
          capture.mockResolvedValue(intent('succeeded') as never);
          cancel.mockResolvedValue(intent('canceled') as never);
          refund.mockResolvedValue({ id: 're_1', status: 'succeeded' } as never);
        },
        idempotencyKeys: () =>
          [capture, cancel, refund].flatMap((spy) =>
            spy.mock.calls.map(
              (call) => (call[call.length - 1] as { idempotencyKey: string }).idempotencyKey,
            ),
          ),
      };
    },
  };
}

const HARNESSES: ConformanceHarness[] = [
  offlineHarness(CodPaymentProvider),
  offlineHarness(ManualPaymentProvider),
  stripeHarness(),
];

const ALL_STATUSES = Object.values(PaymentStatus);
const amount = new Prisma.Decimal('125.50');
const currencyCode = 'EUR';
const config = {};
const reference = 'ref_1';

describe.each(HARNESSES.map((h) => [h.providerId, h] as const))(
  '%s payment provider conformance',
  (_id, harness) => {
    let provider: PaymentProvider;
    let stubSuccess: () => void;
    let idempotencyKeys: () => string[];

    beforeEach(() => {
      ({ provider, stubSuccess, idempotencyKeys } = harness.make());
    });

    afterEach(() => jest.restoreAllMocks());

    const capture = (status: PaymentStatus, idempotencyKey = 'key-capture') =>
      provider.capture({ reference, status, amount, currencyCode, idempotencyKey, config });
    const cancel = (status: PaymentStatus, idempotencyKey = 'key-cancel') =>
      provider.cancel({ reference, status, idempotencyKey, config });
    const refund = (
      status: PaymentStatus,
      value: Prisma.Decimal = amount,
      idempotencyKey = 'key-refund',
    ) =>
      provider.refund({
        reference,
        status,
        amount: value,
        refundableAmount: amount,
        currencyCode,
        idempotencyKey,
        config,
      });

    const refused = (action: string, from: PaymentStatus) => ({
      response: {
        error: {
          code: 'PAYMENT_TRANSITION_NOT_ALLOWED',
          details: { providerId: harness.providerId, action, from },
        },
      },
    });

    it('exposes its id on the instance', () => {
      expect(provider.id).toBe(harness.providerId);
    });

    describe.each([
      ['capture', () => harness.captureFrom, capture],
      ['cancel', () => harness.cancelFrom, cancel],
      ['refund', () => REFUND_FROM, (status: PaymentStatus) => refund(status)],
    ] as const)('%s', (action, allowedFrom, run) => {
      it('refuses every status outside its allowed set without a remote call', async () => {
        stubSuccess();
        const allowed = allowedFrom();
        for (const status of ALL_STATUSES.filter((s) => !allowed.includes(s))) {
          await expect(run(status)).rejects.toMatchObject(refused(action, status));
        }
        expect(idempotencyKeys()).toEqual([]);
      });
    });

    it('captures to CAPTURED from every allowed status', async () => {
      stubSuccess();
      for (const status of harness.captureFrom) {
        await expect(capture(status)).resolves.toEqual({
          reference,
          status: PaymentStatus.CAPTURED,
        });
      }
    });

    it('cancels to CANCELLED from every allowed status', async () => {
      stubSuccess();
      for (const status of harness.cancelFrom) {
        await expect(cancel(status)).resolves.toEqual({
          reference,
          status: PaymentStatus.CANCELLED,
        });
      }
    });

    it('refunds what is left to REFUNDED and less to PARTIALLY_REFUNDED', async () => {
      stubSuccess();
      for (const status of REFUND_FROM) {
        await expect(refund(status)).resolves.toEqual({
          reference,
          status: PaymentStatus.REFUNDED,
        });
        await expect(refund(status, new Prisma.Decimal('25.50'))).resolves.toEqual({
          reference,
          status: PaymentStatus.PARTIALLY_REFUNDED,
        });
      }
    });

    it('refuses a refund above what is left, or of zero or less, without a remote call', async () => {
      stubSuccess();
      for (const value of ['125.51', '0', '-1']) {
        await expect(
          refund(PaymentStatus.CAPTURED, new Prisma.Decimal(value)),
        ).rejects.toMatchObject(refused('refund', PaymentStatus.CAPTURED));
      }
      expect(idempotencyKeys()).toEqual([]);
    });

    it('sends the caller idempotency key with every remote mutation', async () => {
      stubSuccess();
      await capture(harness.captureFrom[0], 'key-a');
      await cancel(harness.cancelFrom[0], 'key-b');
      await refund(PaymentStatus.CAPTURED, amount, 'key-c');
      expect(idempotencyKeys()).toEqual(harness.remote ? ['key-a', 'key-b', 'key-c'] : []);
    });

    it('rejects an unsigned webhook with a client error', async () => {
      const error = await provider
        .parseWebhook({ headers: {}, rawBody: Buffer.from('{}'), config })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpException);
      const status = (error as HttpException).getStatus();
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    });
  },
);
