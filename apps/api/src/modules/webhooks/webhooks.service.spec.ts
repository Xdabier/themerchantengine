import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { IdempotencyService } from '../../common/idempotency.service';
import { WebhooksService } from './webhooks.service';
import {
  WEBHOOK_DELIVERY_QUEUE,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_PAYLOAD_VERSION,
} from './webhooks.constants';
import {
  generateSecret,
  isBlockedHostname,
  signPayload,
  validateWebhookUrl,
} from './webhooks.utils';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockPrisma = {
  webhookSubscription: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  webhookDelivery: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  processedWebhook: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};

const mockQueue = {
  add: jest.fn(),
};

function makeSub(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sub-1',
    url: 'https://example.com/hook',
    events: ['order.created'],
    secret: 'abc123',
    isActive: true,
    failureCount: 0,
    lastDeliveredAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// ── Suite ──────────────────────────────────────────────────────────────────────

describe('WebhooksService', () => {
  let service: WebhooksService;
  let idempotency: {
    beginRequest: jest.Mock;
    completeRequest: jest.Mock;
    abortRequest: jest.Mock;
    isReplay: jest.Mock;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    idempotency = {
      beginRequest: jest.fn().mockResolvedValue({ state: 'fresh' }),
      completeRequest: jest.fn().mockResolvedValue(undefined),
      abortRequest: jest.fn().mockResolvedValue(undefined),
      isReplay: jest.fn().mockReturnValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken(WEBHOOK_DELIVERY_QUEUE), useValue: mockQueue },
        { provide: IdempotencyService, useValue: idempotency },
      ],
    }).compile();

    service = module.get(WebhooksService);
  });

  // ── Utils: HMAC signing ──────────────────────────────────────────────────────

  describe('signPayload', () => {
    it('produces correct HMAC-SHA256 hex digest', () => {
      const body = '{"hello":"world"}';
      const secret = 'mysecret';
      const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
      expect(signPayload(body, secret)).toBe(expected);
    });

    it('returns different digests for different bodies', () => {
      const secret = 'mysecret';
      expect(signPayload('aaa', secret)).not.toBe(signPayload('bbb', secret));
    });

    it('returns different digests for different secrets', () => {
      const body = '{"x":1}';
      expect(signPayload(body, 'sec1')).not.toBe(signPayload(body, 'sec2'));
    });
  });

  describe('generateSecret', () => {
    it('returns a 64-character hex string', () => {
      const s = generateSecret();
      expect(s).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns a unique value on every call', () => {
      expect(generateSecret()).not.toBe(generateSecret());
    });
  });

  // ── Utils: IP / URL validation ───────────────────────────────────────────────

  describe('isBlockedHostname', () => {
    const blocked = [
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '192.168.0.0',
      '127.0.0.1',
      '127.1.2.3',
      '169.254.0.1',
      '::1',
      'localhost',
      '0.0.0.0',
    ];

    const allowed = [
      'example.com',
      'hooks.example.com',
      '8.8.8.8',
      '1.1.1.1',
      '172.15.0.1', // just below 172.16 range
      '172.32.0.1', // just above 172.31 range
      '11.0.0.1', // outside 10.x range
      '192.169.0.1', // outside 192.168 range
    ];

    blocked.forEach((h) => {
      it(`blocks ${h}`, () => {
        expect(isBlockedHostname(h)).toBe(true);
      });
    });

    allowed.forEach((h) => {
      it(`allows ${h}`, () => {
        expect(isBlockedHostname(h)).toBe(false);
      });
    });
  });

  describe('validateWebhookUrl', () => {
    it('accepts a valid HTTPS external URL', () => {
      expect(() => validateWebhookUrl('https://hooks.example.com/cb')).not.toThrow();
    });

    it('rejects http:// URLs', () => {
      expect(() => validateWebhookUrl('http://example.com/hook')).toThrow(BadRequestException);
    });

    it('rejects malformed URLs', () => {
      expect(() => validateWebhookUrl('not-a-url')).toThrow(BadRequestException);
    });

    it('rejects internal IP URLs', () => {
      expect(() => validateWebhookUrl('https://192.168.1.1/hook')).toThrow(BadRequestException);
    });

    it('rejects localhost', () => {
      expect(() => validateWebhookUrl('https://localhost/hook')).toThrow(BadRequestException);
    });

    it('rejects loopback IPv6', () => {
      expect(() => validateWebhookUrl('https://[::1]/hook')).toThrow(BadRequestException);
    });
  });

  // ── createSubscription ───────────────────────────────────────────────────────

  describe('createSubscription', () => {
    it('creates a subscription with an auto-generated secret', async () => {
      const sub = makeSub();
      mockPrisma.webhookSubscription.create.mockResolvedValueOnce(sub);

      await service.createSubscription({
        url: 'https://example.com/hook',
        events: ['order.created'],
      });

      const call = mockPrisma.webhookSubscription.create.mock.calls[0][0];
      expect(call.data.secret).toMatch(/^[0-9a-f]{64}$/);
      expect(call.data.url).toBe('https://example.com/hook');
    });

    it('uses the provided secret when supplied', async () => {
      mockPrisma.webhookSubscription.create.mockResolvedValueOnce(
        makeSub({ secret: 'user-secret' }),
      );

      await service.createSubscription({
        url: 'https://example.com/hook',
        events: ['order.created'],
        secret: 'user-secret',
      });

      const call = mockPrisma.webhookSubscription.create.mock.calls[0][0];
      expect(call.data.secret).toBe('user-secret');
    });

    it('rejects an internal URL', async () => {
      await expect(
        service.createSubscription({ url: 'https://127.0.0.1/hook', events: ['order.created'] }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.webhookSubscription.create).not.toHaveBeenCalled();
    });
  });

  // ── getSubscription ──────────────────────────────────────────────────────────

  describe('getSubscription', () => {
    it('throws NotFoundException for unknown ID', async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValueOnce(null);
      await expect(service.getSubscription('missing')).rejects.toThrow(NotFoundException);
    });

    it('returns the subscription when found', async () => {
      const sub = makeSub();
      mockPrisma.webhookSubscription.findUnique.mockResolvedValueOnce(sub);
      const result = await service.getSubscription('sub-1');
      expect(result).toEqual(sub);
    });
  });

  // ── dispatchEvent ────────────────────────────────────────────────────────────

  describe('dispatchEvent', () => {
    it('enqueues one job per active matching subscription', async () => {
      mockPrisma.webhookSubscription.findMany.mockResolvedValueOnce([
        { id: 'sub-1' },
        { id: 'sub-2' },
      ]);
      mockPrisma.webhookDelivery.create
        .mockResolvedValueOnce({ id: 'del-1' })
        .mockResolvedValueOnce({ id: 'del-2' });

      await service.dispatchEvent('order.created', { orderId: '123' });

      expect(mockPrisma.webhookDelivery.create).toHaveBeenCalledTimes(2);
      expect(mockQueue.add).toHaveBeenCalledTimes(2);
    });

    it('does nothing when no subscriptions match', async () => {
      mockPrisma.webhookSubscription.findMany.mockResolvedValueOnce([]);

      await service.dispatchEvent('order.created', {});

      expect(mockPrisma.webhookDelivery.create).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('includes correct payload version in the delivery record', async () => {
      mockPrisma.webhookSubscription.findMany.mockResolvedValueOnce([{ id: 'sub-1' }]);
      mockPrisma.webhookDelivery.create.mockResolvedValueOnce({ id: 'del-1' });

      await service.dispatchEvent('order.created', { orderId: '999' });

      const payload = mockPrisma.webhookDelivery.create.mock.calls[0][0].data.payload as Record<
        string,
        unknown
      >;
      expect(payload.version).toBe(WEBHOOK_PAYLOAD_VERSION);
      expect(payload.eventType).toBe('order.created');
    });
  });

  // ── handleDeliveryExhausted / retry logic ────────────────────────────────────

  describe('handleDeliveryExhausted', () => {
    it('increments failureCount without deactivating below threshold', async () => {
      mockPrisma.webhookSubscription.update.mockResolvedValueOnce(makeSub({ failureCount: 3 }));

      await service.handleDeliveryExhausted('sub-1');

      expect(mockPrisma.webhookSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { failureCount: { increment: 1 } } }),
      );
      // failureCount is 3 < 5, so no second update (deactivate)
      expect(mockPrisma.webhookSubscription.update).toHaveBeenCalledTimes(1);
    });

    it('deactivates the subscription after 5 consecutive failures', async () => {
      mockPrisma.webhookSubscription.update
        .mockResolvedValueOnce(makeSub({ failureCount: 5 })) // increment
        .mockResolvedValueOnce(makeSub({ failureCount: 5, isActive: false })); // deactivate

      await service.handleDeliveryExhausted('sub-1');

      expect(mockPrisma.webhookSubscription.update).toHaveBeenCalledTimes(2);
      const deactivateCall = mockPrisma.webhookSubscription.update.mock.calls[1][0];
      expect(deactivateCall.data).toEqual({ isActive: false });
    });
  });

  // ── scheduleRetry ────────────────────────────────────────────────────────────

  describe('scheduleRetry', () => {
    it('creates a new delivery record and enqueues a delayed job', async () => {
      mockPrisma.webhookDelivery.create.mockResolvedValueOnce({ id: 'del-retry' });

      const originalData = {
        subscriptionId: 'sub-1',
        deliveryId: 'del-1',
        eventId: 'evt-1',
        eventType: 'order.created',
        occurredAt: new Date().toISOString(),
        data: { orderId: '1' },
        attempt: 1,
      };

      await service.scheduleRetry(originalData, 60_000, 2);

      expect(mockPrisma.webhookDelivery.create).toHaveBeenCalledTimes(1);
      expect(mockQueue.add).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ attempt: 2, deliveryId: 'del-retry' }),
        expect.objectContaining({ delay: 60_000 }),
      );
    });
  });

  // ── Inbound deduplication (§9.5 I2) ─────────────────────────────────────────

  describe('isEventProcessed / markEventProcessed', () => {
    it('returns false when event has not been processed', async () => {
      mockPrisma.processedWebhook.findUnique.mockResolvedValueOnce(null);
      expect(await service.isEventProcessed('stripe', 'evt_1')).toBe(false);
    });

    it('returns true when event is already processed', async () => {
      mockPrisma.processedWebhook.findUnique.mockResolvedValueOnce({ id: 'pw-1' });
      expect(await service.isEventProcessed('stripe', 'evt_1')).toBe(true);
    });

    it('markEventProcessed inserts a record', async () => {
      mockPrisma.processedWebhook.create.mockResolvedValueOnce({});
      await service.markEventProcessed('stripe', 'evt_2');
      expect(mockPrisma.processedWebhook.create).toHaveBeenCalledWith({
        data: { provider: 'stripe', externalEventId: 'evt_2' },
      });
    });
  });

  // ── WEBHOOK_EVENT_TYPES catalog ──────────────────────────────────────────────

  describe('WEBHOOK_EVENT_TYPES catalog', () => {
    const expected = [
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
    ];

    it('contains all 21 spec event types', () => {
      expect(WEBHOOK_EVENT_TYPES).toHaveLength(21);
    });

    expected.forEach((evt) => {
      it(`includes ${evt}`, () => {
        expect(WEBHOOK_EVENT_TYPES).toContain(evt);
      });
    });
  });
});
