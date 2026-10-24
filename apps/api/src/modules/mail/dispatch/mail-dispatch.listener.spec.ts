import { FR_EN_LOCALE_SET, NEUTRAL_LOCALE_SET, storeLocales } from '@common/locale';
/**
 * MailDispatchListener, behavioural-equivalence proof for the NE4 migration
 * (NE4.1) plus the two net-new capabilities: stable dedup-key derivation
 * (NE4.2/NE4.6) and the enqueue-failed audit row (NE4.3 / Risk R10).
 *
 * Ports every assertion from the deleted order.mail-listener.spec.ts +
 * giftcard.mail-listener.spec.ts against the data-driven engine. The enqueued
 * (code, recipient, variables) MUST be unchanged; the calls now additionally
 * carry a `dispatch:`-namespaced stable `dedupeKey`.
 *
 * E1.4 (DR-31) retargeted the fixtures: money formatted from the store's
 * runtime snapshot (the `maghreb-ltr` scenario, LYD at three decimals), money
 * variables arriving already display-formatted (`1 240,000 LD`) with no
 * separate `currency` variable beside them, and example.test hosts in every
 * link.
 */
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../mail.service';
import { MailDispatchListener } from './mail-dispatch.listener';
import { DISPATCH_TABLE } from './dispatch.table';
import type { DispatchEntry } from './dispatch.types';
import { NEUTRAL_MONEY, storeMoney } from '@common/money';
import { loadStoreConfigFixture } from '@common/store-config-fixtures';

/**
 * The store's two invisible separators, built from codepoints rather than
 * typed: a whitespace-normalising editor or formatter would otherwise be free
 * to collapse either one into a plain space and leave every money assertion
 * below still passing while the rendered email had quietly changed.
 */
const NARROW_NO_BREAK_SPACE = String.fromCodePoint(0x202f); // thousands groups
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0); // amount ↔ symbol

/**
 * `1 240,000 LD`, the order total below as the store writes it. The shape is
 * the operator's config, not the reader's locale, so an English and a French
 * customer read the same string.
 */
const TOTAL = `1${NARROW_NO_BREAK_SPACE}240,000${NO_BREAK_SPACE}LD`;

beforeAll(() => storeMoney.set(loadStoreConfigFixture('maghreb-ltr').money));
afterAll(() => storeMoney.set(NEUTRAL_MONEY));

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    orderNumber: 'ORD-1',
    // Four figures on purpose: it is the only way the group separator is
    // exercised at all.
    total: 1240,
    currency: 'LYD',
    user: { email: 'customer@example.com', firstName: 'Sam', locale: 'en' },
    items: [{ id: 'i1' }, { id: 'i2' }],
    shipments: [],
    ...overrides,
  };
}

function makeReturn(overrides: Record<string, unknown> = {}) {
  return {
    returnNumber: 'RET-1',
    customer: { email: 'customer@example.com', firstName: 'Sam', locale: 'en' },
    order: { orderNumber: 'ORD-1' },
    ...overrides,
  };
}

const entryFor = (template: string): DispatchEntry =>
  DISPATCH_TABLE.find((e) => e.template === template) as DispatchEntry;

beforeEach(() => storeLocales.set(FR_EN_LOCALE_SET));
afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

describe('MailDispatchListener', () => {
  let listener: MailDispatchListener;
  let emitter: { on: jest.Mock };
  let mail: { enqueue: jest.Mock; recordEnqueueFailure: jest.Mock };
  let prisma: {
    order: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
    giftCard: { findUnique: jest.Mock };
    return: { findUnique: jest.Mock };
    productQuestion: { findUnique: jest.Mock };
    review: { findUnique: jest.Mock };
  };
  let config: { get: jest.Mock };

  const orderPlaced = entryFor('order.placed');
  const orderShipped = entryFor('order.shipped');
  const orderConfirmed = entryFor('order.confirmed');
  const orderExchange = entryFor('order.exchange-created');
  const gcPurchase = entryFor('giftcard.purchase');
  const gcRedeemed = entryFor('giftcard.redeemed');
  const gcStoreCredit = entryFor('giftcard.store-credit');
  const returnRequested = entryFor('return.requested');
  const returnRejected = entryFor('return.rejected');
  const returnRefunded = entryFor('return.refunded');
  const questionAnswered = entryFor('question.answered');
  const reviewApproved = entryFor('review.approved');
  const cartAbandoned = entryFor('cart.abandoned');
  const staffInvite = entryFor('admin.staff-invite');
  const passwordChanged = entryFor('auth.password-changed');

  beforeEach(() => {
    emitter = { on: jest.fn() };
    mail = {
      enqueue: jest.fn().mockResolvedValue({ logId: 'l1', jobId: 'j1', suppressed: false }),
      recordEnqueueFailure: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      order: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      giftCard: { findUnique: jest.fn() },
      return: { findUnique: jest.fn() },
      productQuestion: { findUnique: jest.fn() },
      review: { findUnique: jest.fn() },
    };
    const hosts: Record<string, string> = {
      STOREFRONT_PUBLIC_BASE_URL: 'https://storefront.example.test',
      ADMIN_PUBLIC_BASE_URL: 'https://admin.example.test',
    };
    config = {
      get: jest.fn((key: string, dflt?: unknown) => hosts[key] ?? dflt),
    };
    listener = new MailDispatchListener(
      emitter as unknown as EventEmitter2,
      mail as unknown as MailService,
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  });

  describe('onModuleInit binding', () => {
    it('binds exactly one emitter listener per dispatch-table row, by event string', () => {
      listener.onModuleInit();

      expect(emitter.on).toHaveBeenCalledTimes(DISPATCH_TABLE.length);
      for (const entry of DISPATCH_TABLE) {
        expect(emitter.on).toHaveBeenCalledWith(entry.event, expect.any(Function), {
          async: true,
        });
      }
    });

    it('the bound handler routes through dispatch(), invoking it enqueues the flow', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());
      listener.onModuleInit();

      const createdBinding = emitter.on.mock.calls.find((c) => c[0] === 'order.created');
      const handler = createdBinding[1] as (p: unknown) => Promise<void>;
      await handler({ orderId: 'o1' });

      expect(mail.enqueue).toHaveBeenCalledWith('order.placed', expect.any(Object));
    });
  });

  describe('order flows: equivalence', () => {
    it('order.placed enqueues the full variables set (+ stable dedupeKey)', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());

      await listener.dispatch(orderPlaced, { orderId: 'o1' });

      expect(mail.enqueue).toHaveBeenCalledWith(
        'order.placed',
        expect.objectContaining({
          to: 'customer@example.com',
          locale: 'en',
          variables: {
            orderNumber: 'ORD-1',
            customerName: 'Sam',
            // Already display-formatted by the resolver, symbol after the
            // number. No `currency` variable rides beside it any more.
            total: TOTAL,
            itemCount: 2,
            orderUrl: 'https://storefront.example.test/en/account/orders/o1',
          },
          dedupeKey: expect.stringMatching(/^dispatch:/),
        }),
      );
      expect(mail.enqueue.mock.calls[0][1].variables).not.toHaveProperty('currency');
    });

    it('order.shipped folds in trackingNumber + carrier from the latest shipment', async () => {
      prisma.order.findUnique.mockResolvedValue(
        makeOrder({ shipments: [{ trackingNumber: 'TRK9', carrier: 'DHL' }] }),
      );

      await listener.dispatch(orderShipped, { orderId: 'o1' });

      expect(mail.enqueue).toHaveBeenCalledWith(
        'order.shipped',
        expect.objectContaining({
          variables: expect.objectContaining({ trackingNumber: 'TRK9', carrier: 'DHL' }),
        }),
      );
    });

    it.each([['order.placed'], ['order.shipped'], ['order.delivered'], ['order.cancelled']])(
      '%s maps to its code with the shared variable set',
      async (template) => {
        prisma.order.findUnique.mockResolvedValue(makeOrder());

        await listener.dispatch(entryFor(template), { orderId: 'o1' });

        expect(mail.enqueue).toHaveBeenCalledWith(
          template,
          expect.objectContaining({
            to: 'customer@example.com',
            locale: 'en',
            variables: expect.objectContaining({
              orderNumber: 'ORD-1',
              itemCount: 2,
              orderUrl: 'https://storefront.example.test/en/account/orders/o1',
            }),
            dedupeKey: expect.stringMatching(/^dispatch:/),
          }),
        );
      },
    );

    it('order.delivered with a shipment present still carries tracking info', async () => {
      prisma.order.findUnique.mockResolvedValue(
        makeOrder({ shipments: [{ trackingNumber: 'TRK-D', carrier: 'Aramex' }] }),
      );

      await listener.dispatch(entryFor('order.delivered'), { orderId: 'o1' });

      expect(mail.enqueue).toHaveBeenCalledWith(
        'order.delivered',
        expect.objectContaining({
          variables: expect.objectContaining({ trackingNumber: 'TRK-D', carrier: 'Aramex' }),
        }),
      );
    });

    it('resolves the French locale from the customer record, the total keeping the store shape', async () => {
      prisma.order.findUnique.mockResolvedValue(
        makeOrder({ user: { email: 'a@b.com', firstName: 'Sam', locale: 'fr-TN' } }),
      );

      await listener.dispatch(orderPlaced, { orderId: 'o1' });

      expect(mail.enqueue).toHaveBeenCalledWith(
        'order.placed',
        expect.objectContaining({
          locale: 'fr',
          // The same amount as the en case above, read by a French customer:
          // nothing about the money follows the recipient (DR-31).
          variables: expect.objectContaining({ total: TOTAL }),
        }),
      );
    });

    it('writes to a customer carrying a stale locale in French', async () => {
      // Rows migrated from the previous client still hold `ar`. The mail
      // resolver normalises anything unrecognised to the store default rather
      // than dropping such a customer into English.
      prisma.order.findUnique.mockResolvedValue(
        makeOrder({ user: { email: 'a@b.com', firstName: 'Sam', locale: 'ar' } }),
      );

      await listener.dispatch(orderPlaced, { orderId: 'o1' });

      expect(mail.enqueue).toHaveBeenCalledWith(
        'order.placed',
        expect.objectContaining({ locale: 'fr' }),
      );
    });

    it('skips (no enqueue) when the order has no recipient email', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder({ user: { email: null } }));

      await listener.dispatch(orderPlaced, { orderId: 'o1' });

      expect(mail.enqueue).not.toHaveBeenCalled();
      expect(mail.recordEnqueueFailure).not.toHaveBeenCalled();
    });
  });

  describe('gift-card flows: equivalence', () => {
    it('giftcard.purchase enqueues code + balance + optional fields (+ stable dedupeKey)', async () => {
      prisma.user.findUnique.mockResolvedValue({ firstName: 'Sam', lastName: 'Lee', locale: 'en' });

      await listener.dispatch(gcPurchase, {
        cardId: 'c1',
        code: 'GC-123',
        recipientEmail: 'recipient@example.com',
        recipientName: 'Rita',
        personalMessage: 'Enjoy!',
        initialBalance: 50,
        currency: 'LYD',
        purchaserUserId: 'u1',
      });

      expect(mail.enqueue).toHaveBeenCalledWith(
        'giftcard.purchase',
        expect.objectContaining({
          to: 'recipient@example.com',
          locale: 'en',
          variables: {
            code: 'GC-123',
            initialBalance: `50,000${NO_BREAK_SPACE}LD`,
            recipientName: 'Rita',
            purchaserName: 'Sam Lee',
            personalMessage: 'Enjoy!',
            redemptionUrl: 'https://storefront.example.test/en/cart?code=GC-123',
          },
          dedupeKey: expect.stringMatching(/^dispatch:/),
        }),
      );
      const purchase = mail.enqueue.mock.calls.find((c) => c[0] === 'giftcard.purchase');
      expect(purchase[1].variables).not.toHaveProperty('currency');
    });

    it('giftcard.purchase builds a partial purchaserName when one name field is null', async () => {
      prisma.user.findUnique.mockResolvedValue({ firstName: 'Sam', lastName: null, locale: 'en' });

      await listener.dispatch(gcPurchase, {
        cardId: 'c1',
        code: 'GC-123',
        recipientEmail: 'recipient@example.com',
        recipientName: null,
        personalMessage: null,
        initialBalance: 50,
        currency: 'LYD',
        purchaserUserId: 'u1',
      });

      const call = mail.enqueue.mock.calls.find((c) => c[0] === 'giftcard.purchase');
      expect(call[1].variables.purchaserName).toBe('Sam');
      expect(call[1].variables).not.toHaveProperty('recipientName');
      expect(call[1].variables).not.toHaveProperty('personalMessage');
    });

    it('giftcard.purchase falls back to the purchaser email on self-buy (recipientEmail null)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        email: 'buyer@example.com',
        firstName: 'Sam',
        lastName: null,
        locale: 'en',
      });

      await listener.dispatch(gcPurchase, {
        cardId: 'c1',
        code: 'GC-123',
        recipientEmail: null,
        recipientName: null,
        personalMessage: null,
        initialBalance: 50,
        currency: 'LYD',
        purchaserUserId: 'u1',
      });

      const call = mail.enqueue.mock.calls.find((c) => c[0] === 'giftcard.purchase');
      expect(call[1].to).toBe('buyer@example.com');
    });

    it('giftcard.purchase no-ops when neither recipient nor purchaser email resolves', async () => {
      prisma.user.findUnique.mockResolvedValue({
        email: null,
        firstName: null,
        lastName: null,
        locale: 'en',
      });

      await listener.dispatch(gcPurchase, {
        cardId: 'c1',
        code: 'GC-123',
        recipientEmail: null,
        recipientName: null,
        personalMessage: null,
        initialBalance: 50,
        currency: 'LYD',
        purchaserUserId: 'u1',
      });

      expect(mail.enqueue).not.toHaveBeenCalled();
    });

    it('giftcard.purchase with forceResend omits the dedupeKey (genuine resend)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        email: null,
        firstName: 'Sam',
        lastName: 'Lee',
        locale: 'en',
      });

      await listener.dispatch(gcPurchase, {
        cardId: 'c1',
        code: 'GC-123',
        recipientEmail: 'recipient@example.com',
        recipientName: null,
        personalMessage: null,
        initialBalance: 50,
        currency: 'LYD',
        purchaserUserId: 'u1',
        forceResend: true,
      });

      const call = mail.enqueue.mock.calls.find((c) => c[0] === 'giftcard.purchase');
      expect(call[1].to).toBe('recipient@example.com');
      expect(call[1]).not.toHaveProperty('dedupeKey');
    });

    it('giftcard.redeemed enqueues the receipt to the purchaser (locale fr, orderUrl)', async () => {
      prisma.giftCard.findUnique.mockResolvedValue({ purchasedBy: 'u1' });
      prisma.user.findUnique.mockResolvedValue({ email: 'purchaser@example.com', locale: 'fr' });
      prisma.order.findUnique.mockResolvedValue({ id: 'o-9', orderNumber: 'ORD-9' });

      await listener.dispatch(gcRedeemed, {
        cardId: 'c1',
        code: 'GC-123',
        amount: 20,
        remainingBalance: 30,
        currency: 'LYD',
        orderId: 'o1',
      });

      expect(mail.enqueue).toHaveBeenCalledWith(
        'giftcard.redeemed',
        expect.objectContaining({
          to: 'purchaser@example.com',
          locale: 'fr',
          variables: {
            code: 'GC-123',
            amountRedeemed: `20,000${NO_BREAK_SPACE}LD`,
            remainingBalance: `30,000${NO_BREAK_SPACE}LD`,
            orderNumber: 'ORD-9',
            orderUrl: 'https://storefront.example.test/fr/account/orders/o-9',
          },
          dedupeKey: expect.stringMatching(/^dispatch:/),
        }),
      );
      const redeemed = mail.enqueue.mock.calls.find((c) => c[0] === 'giftcard.redeemed');
      expect(redeemed[1].variables).not.toHaveProperty('currency');
    });

    it('giftcard.redeemed omits orderNumber/orderUrl when the order row is missing', async () => {
      prisma.giftCard.findUnique.mockResolvedValue({ purchasedBy: 'u1' });
      prisma.user.findUnique.mockResolvedValue({ email: 'p@e.com', locale: 'en' });
      prisma.order.findUnique.mockResolvedValue(null);

      await listener.dispatch(gcRedeemed, {
        cardId: 'c1',
        code: 'GC-123',
        amount: 20,
        remainingBalance: 30,
        currency: 'LYD',
        orderId: 'o1',
      });

      const call = mail.enqueue.mock.calls.find((c) => c[0] === 'giftcard.redeemed');
      expect(call[1].variables).not.toHaveProperty('orderNumber');
      expect(call[1].variables).not.toHaveProperty('orderUrl');
    });

    it('giftcard.redeemed no-ops when the card has no purchaser', async () => {
      prisma.giftCard.findUnique.mockResolvedValue({ purchasedBy: null });

      await listener.dispatch(gcRedeemed, {
        cardId: 'c1',
        code: 'GC-123',
        amount: 20,
        remainingBalance: 30,
        currency: 'LYD',
        orderId: 'o1',
      });

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(mail.enqueue).not.toHaveBeenCalled();
    });

    it('giftcard.redeemed no-ops when the purchaser has no email', async () => {
      prisma.giftCard.findUnique.mockResolvedValue({ purchasedBy: 'u1', recipientEmail: null });
      prisma.user.findUnique.mockResolvedValue({ email: null, locale: 'en' });

      await listener.dispatch(gcRedeemed, {
        cardId: 'c1',
        code: 'GC-123',
        amount: 20,
        remainingBalance: 30,
        currency: 'LYD',
        orderId: 'o1',
      });

      expect(mail.enqueue).not.toHaveBeenCalled();
    });

    it('giftcard.redeemed falls back to the card recipient for a purchaser-less card (store credit)', async () => {
      prisma.giftCard.findUnique.mockResolvedValue({
        purchasedBy: null,
        recipientEmail: 'holder@example.com',
      });
      prisma.order.findUnique.mockResolvedValue({ id: 'o-9', orderNumber: 'ORD-9' });

      await listener.dispatch(gcRedeemed, {
        cardId: 'c1',
        code: 'GC-123',
        amount: 20,
        remainingBalance: 30,
        currency: 'LYD',
        orderId: 'o1',
      });

      const call = mail.enqueue.mock.calls.find((c) => c[0] === 'giftcard.redeemed');
      expect(call[1].to).toBe('holder@example.com');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('giftcard.store-credit enqueues balance + code to the granted recipient', async () => {
      prisma.user.findUnique.mockResolvedValue({ locale: 'fr' });

      await listener.dispatch(gcStoreCredit, {
        cardId: 'c1',
        code: 'GC-SC',
        recipientEmail: 'r@e.com',
        balance: 75,
        currency: 'LYD',
      });

      expect(mail.enqueue).toHaveBeenCalledWith(
        'giftcard.store-credit',
        expect.objectContaining({
          to: 'r@e.com',
          locale: 'fr',
          variables: {
            code: 'GC-SC',
            // LYD is a three-decimal currency: 1 LD = 1000 dirhams, so the
            // third digit is a real one and not padding. The symbol follows
            // the number, and no separate `currency` variable rides beside it.
            balance: `75,000${NO_BREAK_SPACE}LD`,
            redemptionUrl: 'https://storefront.example.test/fr/cart?code=GC-SC',
          },
          dedupeKey: expect.stringMatching(/^dispatch:/),
        }),
      );
      const credit = mail.enqueue.mock.calls.find((c) => c[0] === 'giftcard.store-credit');
      expect(credit[1].variables).not.toHaveProperty('currency');
    });

    it('giftcard.store-credit keeps a legacy card at its own currency precision', async () => {
      // A card minted before a currency change still carries AED, a
      // two-decimal currency. The formatter takes symbol and precision from
      // the catalogue for that row rather than forcing the store's three
      // digits, and keeps the store's separators and symbol side.
      prisma.user.findUnique.mockResolvedValue({ locale: 'fr' });

      await listener.dispatch(gcStoreCredit, {
        cardId: 'c1',
        code: 'GC-OLD',
        recipientEmail: 'r@e.com',
        balance: 75,
        currency: 'AED',
      });

      const call = mail.enqueue.mock.calls.find((c) => c[0] === 'giftcard.store-credit');
      expect(call[1].variables.balance).toBe(`75,00${NO_BREAK_SPACE}د.إ`);
    });

    it('giftcard.store-credit skips when there is no recipient email', async () => {
      await listener.dispatch(gcStoreCredit, {
        cardId: 'c1',
        code: 'GC-SC',
        recipientEmail: null,
        balance: 75,
        currency: 'LYD',
      });

      expect(mail.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('return flows (NE5)', () => {
    it('return.requested enqueues returnNumber + orderNumber + customerName + returnUrl (+ dedupeKey)', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReturn());

      await listener.dispatch(returnRequested, { returnId: 'r1' });

      expect(mail.enqueue).toHaveBeenCalledWith(
        'return.requested',
        expect.objectContaining({
          to: 'customer@example.com',
          locale: 'en',
          variables: {
            returnNumber: 'RET-1',
            orderNumber: 'ORD-1',
            customerName: 'Sam',
            returnUrl: 'https://storefront.example.test/en/account/returns',
          },
          dedupeKey: expect.stringMatching(/^dispatch:/),
        }),
      );
    });

    it('resolves the French locale from the customer record', async () => {
      prisma.return.findUnique.mockResolvedValue(
        makeReturn({ customer: { email: 'a@b.com', firstName: 'Sam', locale: 'fr-TN' } }),
      );

      await listener.dispatch(returnRequested, { returnId: 'r1' });

      expect(mail.enqueue).toHaveBeenCalledWith(
        'return.requested',
        expect.objectContaining({ locale: 'fr' }),
      );
    });

    it('skips (no enqueue) when the return customer has no email', async () => {
      prisma.return.findUnique.mockResolvedValue(
        makeReturn({ customer: { email: null, firstName: 'Sam', locale: 'en' } }),
      );

      await listener.dispatch(returnRequested, { returnId: 'r1' });

      expect(mail.enqueue).not.toHaveBeenCalled();
    });

    it('return.rejected folds in the reason when present, omits it when absent', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReturn());

      await listener.dispatch(returnRejected, { returnId: 'r1', reason: 'Outside return window' });
      let call = mail.enqueue.mock.calls.find((c) => c[0] === 'return.rejected');
      expect(call[1].variables.reason).toBe('Outside return window');

      mail.enqueue.mockClear();
      await listener.dispatch(returnRejected, { returnId: 'r1' });
      call = mail.enqueue.mock.calls.find((c) => c[0] === 'return.rejected');
      expect(call[1].variables).not.toHaveProperty('reason');
    });

    it('return.refunded STORE_CREDIT surfaces the minted code in refundDetail', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReturn());

      await listener.dispatch(returnRefunded, {
        returnId: 'r1',
        refundMethod: 'STORE_CREDIT',
        refundAmount: 25,
        currency: 'LYD',
        storeCreditCode: 'GC-STORE-9',
      });

      const call = mail.enqueue.mock.calls.find((c) => c[0] === 'return.refunded');
      expect(call[1].variables.refundAmount).toBe(`25,000${NO_BREAK_SPACE}LD`);
      expect(call[1].variables).not.toHaveProperty('currency');
      expect(call[1].variables.refundDetail).toContain('GC-STORE-9');
    });

    it('return.refunded EXCHANGE + ORIGINAL_PAYMENT produce distinct detail copy', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReturn());

      await listener.dispatch(returnRefunded, {
        returnId: 'r1',
        refundMethod: 'EXCHANGE',
        refundAmount: 10,
        currency: 'LYD',
      });
      let call = mail.enqueue.mock.calls.find((c) => c[0] === 'return.refunded');
      expect(call[1].variables.refundDetail).toMatch(/exchange order/i);

      mail.enqueue.mockClear();
      await listener.dispatch(returnRefunded, {
        returnId: 'r1',
        refundMethod: 'ORIGINAL_PAYMENT',
        refundAmount: 10,
        currency: 'LYD',
      });
      call = mail.enqueue.mock.calls.find((c) => c[0] === 'return.refunded');
      expect(call[1].variables.refundDetail).toMatch(/original payment/i);
    });

    it('return.refunded builds the French refundDetail from the customer locale', async () => {
      prisma.return.findUnique.mockResolvedValue(
        makeReturn({ customer: { email: 'a@b.com', firstName: 'Sam', locale: 'fr' } }),
      );

      await listener.dispatch(returnRefunded, {
        returnId: 'r1',
        refundMethod: 'STORE_CREDIT',
        refundAmount: 25,
        currency: 'LYD',
        storeCreditCode: 'GC-FR-9',
      });

      const call = mail.enqueue.mock.calls.find((c) => c[0] === 'return.refunded');
      expect(call[1].locale).toBe('fr');
      expect(call[1].variables.refundDetail).toContain('porté en avoir sur votre compte');
      expect(call[1].variables.refundDetail).toContain('GC-FR-9');
      // The money shape is the store's whatever the recipient locale.
      expect(call[1].variables.refundAmount).toBe(`25,000${NO_BREAK_SPACE}LD`);
    });

    it('order.confirmed + order.exchange-created reuse resolveOrder against the order', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());

      await listener.dispatch(orderConfirmed, { orderId: 'o1' });
      await listener.dispatch(orderExchange, { orderId: 'o1' });

      expect(mail.enqueue).toHaveBeenCalledWith(
        'order.confirmed',
        expect.objectContaining({
          to: 'customer@example.com',
          variables: expect.objectContaining({ orderNumber: 'ORD-1' }),
        }),
      );
      expect(mail.enqueue).toHaveBeenCalledWith(
        'order.exchange-created',
        expect.objectContaining({
          to: 'customer@example.com',
          variables: expect.objectContaining({ orderNumber: 'ORD-1' }),
        }),
      );
    });
  });

  describe('reviews & Q&A flows (NE5)', () => {
    it('question.answered notifies the asker with the localized product name (Risk R6)', async () => {
      prisma.productQuestion.findUnique.mockResolvedValue({
        askedById: 'asker-1',
        asker: { email: 'asker@example.com', locale: 'fr' },
        product: {
          slug: 'fraise-diamantee',
          name: { fr: 'Fraise diamantée', en: 'Diamond bur' },
        },
      });

      await listener.dispatch(questionAnswered, {
        questionId: 'q1',
        productId: 'p1',
        userId: 'staff-1',
      });

      expect(mail.enqueue).toHaveBeenCalledWith(
        'question.answered',
        expect.objectContaining({
          to: 'asker@example.com',
          locale: 'fr',
          variables: {
            productName: 'Fraise diamantée',
            productUrl: 'https://storefront.example.test/fr/catalog/product/fraise-diamantee',
          },
          dedupeKey: expect.stringMatching(/^dispatch:/),
        }),
      );
    });

    it('question.answered skips an anonymous question (askedById null)', async () => {
      prisma.productQuestion.findUnique.mockResolvedValue({
        askedById: null,
        asker: null,
        product: { slug: 'x', name: { en: 'X' } },
      });

      await listener.dispatch(questionAnswered, { questionId: 'q1' });

      expect(mail.enqueue).not.toHaveBeenCalled();
    });

    it('review.approved notifies the author (loaded via Review.userId)', async () => {
      prisma.review.findUnique.mockResolvedValue({
        user: { email: 'author@example.com', locale: 'en' },
        product: {
          slug: 'fraise-diamantee',
          name: { fr: 'Fraise diamantée', en: 'Diamond bur' },
        },
      });

      await listener.dispatch(reviewApproved, { reviewId: 'rv1', productId: 'p1' });

      expect(mail.enqueue).toHaveBeenCalledWith(
        'review.approved',
        expect.objectContaining({
          to: 'author@example.com',
          locale: 'en',
          variables: {
            productName: 'Diamond bur',
            productUrl: 'https://storefront.example.test/en/catalog/product/fraise-diamantee',
          },
          dedupeKey: expect.stringMatching(/^dispatch:/),
        }),
      );
    });

    it('review.approved skips when the author has no email', async () => {
      prisma.review.findUnique.mockResolvedValue({
        user: { email: null, locale: 'en' },
        product: { slug: 'x', name: { en: 'X' } },
      });

      await listener.dispatch(reviewApproved, { reviewId: 'rv1' });

      expect(mail.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('cart flow (NE5)', () => {
    it('cart.abandoned enqueues itemCount + subtotal + recovery URL to the customer', async () => {
      prisma.user.findUnique.mockResolvedValue({ locale: 'en' });

      await listener.dispatch(cartAbandoned, {
        cartId: 'cart-1',
        userId: 'u1',
        customerEmail: 'shopper@example.com',
        items: [{ quantity: 2 }, { quantity: 1 }],
        subtotal: 149.5,
      });

      expect(mail.enqueue).toHaveBeenCalledWith(
        'cart.abandoned',
        expect.objectContaining({
          to: 'shopper@example.com',
          locale: 'en',
          variables: {
            itemCount: 3,
            // The abandoned-cart mail is the one dispatch path with no row to
            // read a currency from, so it formats in the store currency from
            // the runtime snapshot (DR-31), and it reaches the customer
            // already formatted.
            subtotal: `149,500${NO_BREAK_SPACE}LD`,
            cartUrl: 'https://storefront.example.test/en/cart?recover=cart-1',
          },
          dedupeKey: expect.stringMatching(/^dispatch:/),
        }),
      );
      const cart = mail.enqueue.mock.calls.find((c) => c[0] === 'cart.abandoned');
      expect(cart[1].variables).not.toHaveProperty('currency');
    });

    it('cart.abandoned skips an anonymous cart (no customerEmail)', async () => {
      await listener.dispatch(cartAbandoned, {
        cartId: 'cart-1',
        userId: null,
        customerEmail: null,
        items: [{ quantity: 1 }],
        subtotal: 50,
      });

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(mail.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('account & auth flows (NE5)', () => {
    it('admin.staff-invite enqueues the admin login URL + role to the new staff member', async () => {
      prisma.user.findUnique.mockResolvedValue({
        email: 'staff@example.com',
        firstName: 'Sam',
        role: 'ADMIN',
        locale: 'en',
      });

      await listener.dispatch(staffInvite, { userId: 'staff-1' });

      expect(mail.enqueue).toHaveBeenCalledWith(
        'admin.staff-invite',
        expect.objectContaining({
          to: 'staff@example.com',
          locale: 'en',
          variables: expect.objectContaining({
            actionUrl: 'https://admin.example.test/login',
            role: 'ADMIN',
          }),
          dedupeKey: expect.stringMatching(/^dispatch:/),
        }),
      );
    });

    it('auth.password-changed enqueues a security alert with NO dedupeKey (each change is distinct)', async () => {
      prisma.user.findUnique.mockResolvedValue({ email: 'owner@example.com', locale: 'fr' });

      await listener.dispatch(passwordChanged, { userId: 'u1' });

      const call = mail.enqueue.mock.calls.find((c) => c[0] === 'auth.password-changed');
      expect(call[1].to).toBe('owner@example.com');
      expect(call[1].locale).toBe('fr');
      expect(call[1]).not.toHaveProperty('dedupeKey');
    });

    it('account flows skip when the user has no email', async () => {
      prisma.user.findUnique.mockResolvedValue({ email: null, locale: 'en' });

      await listener.dispatch(staffInvite, { userId: 'staff-1' });
      await listener.dispatch(passwordChanged, { userId: 'u1' });

      expect(mail.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('failure handling (Risk R10)', () => {
    it('swallows a resolver error, never enqueues, and records an enqueue-failed row', async () => {
      prisma.order.findUnique.mockRejectedValue(new Error('db down'));

      await expect(listener.dispatch(orderPlaced, { orderId: 'o1' })).resolves.toBeUndefined();

      expect(mail.enqueue).not.toHaveBeenCalled();
      expect(mail.recordEnqueueFailure).toHaveBeenCalledWith(
        'order.placed',
        '(unresolved)',
        'db down',
        { event: 'order.created' },
      );
    });

    it('records an enqueue-failed row with the resolved recipient when enqueue throws', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());
      mail.enqueue.mockRejectedValueOnce(new Error('queue boom'));

      await expect(listener.dispatch(orderPlaced, { orderId: 'o1' })).resolves.toBeUndefined();

      expect(mail.recordEnqueueFailure).toHaveBeenCalledWith(
        'order.placed',
        'customer@example.com',
        'queue boom',
        { event: 'order.created' },
      );
    });
  });
});
