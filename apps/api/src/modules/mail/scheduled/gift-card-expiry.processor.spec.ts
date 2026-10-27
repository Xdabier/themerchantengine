import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { NEUTRAL_MONEY, storeMoney } from '@common/money';
import { loadStoreConfigFixture } from '@common/store-config-fixtures';
import { GiftCardExpiryProcessor } from './gift-card-expiry.processor';

/** No-break space between the amount and its symbol (DR-31). */
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0);

// Money is formatted from the process-wide snapshot (DR-31), so the suite
// pins one scenario: LYD, symbol after, decimal comma, three decimals.
beforeAll(() => storeMoney.set(loadStoreConfigFixture('maghreb-ltr').money));
afterAll(() => storeMoney.set(NEUTRAL_MONEY));

function makeMocks() {
  const prisma = {
    giftCard: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findUnique: jest.fn().mockResolvedValue({ locale: 'en' }) },
  };
  const mail = { enqueue: jest.fn().mockResolvedValue({ logId: 'l1', suppressed: false }) };
  const config = {
    get: jest.fn().mockReturnValue('https://storefront.example.test'),
  } as unknown as ConfigService;
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const proc = new GiftCardExpiryProcessor(prisma as never, mail as never, config, queue as never);
  return { prisma, mail, config, queue, proc };
}

const JOB = {} as Job;

function makeCard(over: Record<string, unknown> = {}) {
  return {
    id: 'gc-1',
    code: 'ABC123',
    currentBalance: 50,
    currency: 'LYD',
    recipientEmail: 'r@x.com',
    purchasedBy: null,
    expiresAt: new Date('2026-07-01'),
    ...over,
  };
}

describe('GiftCardExpiryProcessor (NE8)', () => {
  it('registers a daily repeatable cron with a stable jobId', async () => {
    const { proc, queue } = makeMocks();
    await proc.onModuleInit();
    expect(queue.add).toHaveBeenCalledWith(
      'scan',
      {},
      { repeat: { pattern: '0 8 * * *' }, jobId: 'gift-card-expiry-cron' },
    );
  });

  it('enqueues one reminder per expiring card with a per-(card,mark) dedupe key', async () => {
    const { proc, prisma, mail } = makeMocks();
    // First mark (14) returns a card; second mark (3) returns none.
    prisma.giftCard.findMany.mockResolvedValueOnce([makeCard()]).mockResolvedValueOnce([]);

    await proc.process(JOB);

    expect(mail.enqueue).toHaveBeenCalledTimes(1);
    expect(mail.enqueue).toHaveBeenCalledWith(
      'giftcard.expiry-reminder',
      expect.objectContaining({
        to: 'r@x.com',
        variables: expect.objectContaining({
          code: 'ABC123',
          // Display-formatted at the card currency's own precision, symbol
          // after the number. There is no separate `currency` variable.
          balance: `50,000${NO_BREAK_SPACE}LD`,
          // A date a practitioner plans around, in the recipient's own
          // locale, never the `2026-07-01` machine stamp this used to send.
          expiresOn: 'Wednesday, 1 July 2026',
          redemptionUrl: expect.stringContaining('ABC123'),
        }),
        dedupeKey: 'giftcard-expiry:gc-1:14',
      }),
    );
    expect(mail.enqueue.mock.calls[0][1].variables).not.toHaveProperty('currency');
  });

  it('formats the balance and the expiry date for a French recipient', async () => {
    const { proc, prisma, mail } = makeMocks();
    prisma.giftCard.findMany.mockResolvedValueOnce([makeCard()]).mockResolvedValueOnce([]);
    prisma.user.findUnique.mockResolvedValue({ locale: 'fr' });

    await proc.process(JOB);

    expect(mail.enqueue).toHaveBeenCalledWith(
      'giftcard.expiry-reminder',
      expect.objectContaining({
        locale: 'fr',
        variables: expect.objectContaining({
          balance: `50,000${NO_BREAK_SPACE}LD`,
          expiresOn: 'mercredi 1 juillet 2026',
        }),
      }),
    );
  });

  it('falls back to the purchaser email for a card with no recipient', async () => {
    const { proc, prisma, mail } = makeMocks();
    prisma.giftCard.findMany
      .mockResolvedValueOnce([makeCard({ recipientEmail: null, purchasedBy: 'buyer-1' })])
      .mockResolvedValueOnce([]);
    prisma.user.findUnique.mockResolvedValue({ email: 'buyer@x.com', locale: 'fr' });

    await proc.process(JOB);

    expect(mail.enqueue).toHaveBeenCalledWith(
      'giftcard.expiry-reminder',
      expect.objectContaining({ to: 'buyer@x.com', locale: 'fr' }),
    );
  });

  it('skips a card with no resolvable recipient', async () => {
    const { proc, prisma, mail } = makeMocks();
    prisma.giftCard.findMany
      .mockResolvedValueOnce([makeCard({ recipientEmail: null, purchasedBy: null })])
      .mockResolvedValueOnce([]);
    await proc.process(JOB);
    expect(mail.enqueue).not.toHaveBeenCalled();
  });

  it('no-ops when no cards are near expiry', async () => {
    const { proc, mail } = makeMocks();
    await proc.process(JOB);
    expect(mail.enqueue).not.toHaveBeenCalled();
  });
});
