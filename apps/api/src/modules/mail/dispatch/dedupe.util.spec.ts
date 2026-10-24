/**
 * Stable dedup-key derivation (NE4.2 / NE4.6 / Risk R5).
 *
 * The key is the mechanism that turns a non-idempotent re-fire (an event emitted
 * twice for the same logical send) into a single dispatch, NE2's enqueue dedupe
 * short-circuits on a matching BullMQ jobId, and the jobId IS this key.
 */
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../mail.service';
import { stableDedupeKey } from './dedupe.util';
import { MailDispatchListener } from './mail-dispatch.listener';
import { DISPATCH_TABLE } from './dispatch.table';
import type { DispatchEntry } from './dispatch.types';

const entryFor = (template: string): DispatchEntry =>
  DISPATCH_TABLE.find((e) => e.template === template) as DispatchEntry;

describe('stableDedupeKey', () => {
  it('is deterministic: identical inputs derive the identical key', () => {
    expect(stableDedupeKey('order.created', 'o1', 'order.placed')).toBe(
      stableDedupeKey('order.created', 'o1', 'order.placed'),
    );
  });

  it('is namespaced with the dispatch: prefix (never collides with resend:<logId>)', () => {
    expect(stableDedupeKey('order.created', 'o1', 'order.placed')).toMatch(/^dispatch:/);
  });

  it('varies by entityId', () => {
    expect(stableDedupeKey('order.created', 'o1', 'order.placed')).not.toBe(
      stableDedupeKey('order.created', 'o2', 'order.placed'),
    );
  });

  it('varies by event', () => {
    expect(stableDedupeKey('order.created', 'o1', 'order.placed')).not.toBe(
      stableDedupeKey('order.shipped', 'o1', 'order.placed'),
    );
  });

  it('varies by template', () => {
    expect(stableDedupeKey('order.created', 'o1', 'order.placed')).not.toBe(
      stableDedupeKey('order.created', 'o1', 'order.shipped'),
    );
  });
});

describe('dispatch dedup-key derivation', () => {
  let listener: MailDispatchListener;
  let mail: { enqueue: jest.Mock; recordEnqueueFailure: jest.Mock };
  let prisma: {
    order: { findUnique: jest.Mock };
    giftCard: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let config: { get: jest.Mock };

  beforeEach(() => {
    mail = {
      enqueue: jest.fn().mockResolvedValue({ logId: 'l1', jobId: 'j1', suppressed: false }),
      recordEnqueueFailure: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      order: { findUnique: jest.fn() },
      giftCard: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    config = {
      get: jest.fn((key: string, dflt?: unknown) =>
        key === 'STOREFRONT_PUBLIC_BASE_URL' ? 'https://storefront.example.test' : dflt,
      ),
    };
    listener = new MailDispatchListener(
      { on: jest.fn() } as unknown as EventEmitter2,
      mail as unknown as MailService,
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  });

  it('re-firing the same order event derives the identical dedupeKey (Risk R5)', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      orderNumber: 'ORD-1',
      total: 100,
      currency: 'LYD',
      user: { email: 'c@e.com', firstName: 'Sam', locale: 'fr' },
      items: [{ id: 'i1' }],
      shipments: [],
    });

    await listener.dispatch(entryFor('order.placed'), { orderId: 'o1' });
    await listener.dispatch(entryFor('order.placed'), { orderId: 'o1' });

    const k1 = mail.enqueue.mock.calls[0][1].dedupeKey;
    const k2 = mail.enqueue.mock.calls[1][1].dedupeKey;
    expect(k1).toBeDefined();
    expect(k1).toBe(k2);
  });

  it('giftcard.redeemed keys per (card, order), distinct order receipts do NOT collapse', async () => {
    prisma.giftCard.findUnique.mockResolvedValue({ purchasedBy: 'u1' });
    prisma.user.findUnique.mockResolvedValue({ email: 'p@e.com', locale: 'fr' });
    prisma.order.findUnique.mockResolvedValue({ orderNumber: 'ORD-9' });

    const base = { cardId: 'c1', code: 'GC', amount: 5, remainingBalance: 5, currency: 'LYD' };
    await listener.dispatch(gcRedeemedEntry(), { ...base, orderId: 'oA' });
    await listener.dispatch(gcRedeemedEntry(), { ...base, orderId: 'oB' });

    const k1 = mail.enqueue.mock.calls[0][1].dedupeKey;
    const k2 = mail.enqueue.mock.calls[1][1].dedupeKey;
    expect(k1).not.toBe(k2);
  });

  function gcRedeemedEntry(): DispatchEntry {
    return entryFor('giftcard.redeemed');
  }
});
