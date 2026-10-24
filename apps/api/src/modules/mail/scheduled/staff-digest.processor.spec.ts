import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { NEUTRAL_MONEY, storeMoney } from '@common/money';
import { loadStoreConfigFixture } from '@common/store-config-fixtures';
import { StaffDigestProcessor } from './staff-digest.processor';

/** Narrow no-break space, the maghreb-ltr thousands separator. */
const NARROW_NO_BREAK_SPACE = String.fromCodePoint(0x202f);
/** No-break space, between the amount and the symbol. */
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0);

// Money is formatted from the process-wide snapshot (DR-31), so the suite
// pins one scenario: LYD, symbol after, decimal comma, three decimals.
beforeAll(() => storeMoney.set(loadStoreConfigFixture('maghreb-ltr').money));
afterAll(() => storeMoney.set(NEUTRAL_MONEY));

function makeMocks() {
  const prisma = {
    stockLevel: { count: jest.fn().mockResolvedValue(0) },
    return: { count: jest.fn().mockResolvedValue(0) },
    review: { count: jest.fn().mockResolvedValue(0) },
    user: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([{ id: 'a-1', email: 'admin@x.com', locale: 'en' }]),
    },
    order: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { total: 0 }, _count: { _all: 0 } }),
    },
  };
  const mail = { enqueue: jest.fn().mockResolvedValue({ logId: 'l1', suppressed: false }) };
  const config = {
    get: jest.fn().mockReturnValue('https://admin.example.test'),
  } as unknown as ConfigService;
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const proc = new StaffDigestProcessor(prisma as never, mail as never, config, queue as never);
  return { prisma, mail, config, queue, proc };
}

describe('StaffDigestProcessor (NE8)', () => {
  it('registers the daily ops + weekly kpi crons with stable jobIds', async () => {
    const { proc, queue } = makeMocks();
    await proc.onModuleInit();
    expect(queue.add).toHaveBeenCalledWith(
      'ops-digest',
      {},
      { repeat: { pattern: '0 7 * * *' }, jobId: 'staff-ops-digest-cron' },
    );
    expect(queue.add).toHaveBeenCalledWith(
      'kpi-digest',
      {},
      { repeat: { pattern: '0 7 * * 1' }, jobId: 'staff-kpi-digest-cron' },
    );
  });

  describe('ops-digest', () => {
    const job = { name: 'ops-digest' } as Job;

    it('skips the send when every count is zero', async () => {
      const { proc, mail } = makeMocks();
      await proc.process(job);
      expect(mail.enqueue).not.toHaveBeenCalled();
    });

    it('rolls up counts and enqueues one digest per admin', async () => {
      const { proc, prisma, mail } = makeMocks();
      prisma.stockLevel.count.mockResolvedValueOnce(4).mockResolvedValueOnce(2); // low=4, out=2
      prisma.return.count.mockResolvedValue(1);
      prisma.review.count.mockResolvedValue(3);
      prisma.user.findMany.mockResolvedValue([
        { id: 'a-1', email: 'admin1@x.com', locale: 'en' },
        { id: 'a-2', email: 'admin2@x.com', locale: 'fr' },
      ]);

      await proc.process(job);

      expect(mail.enqueue).toHaveBeenCalledTimes(2);
      expect(mail.enqueue).toHaveBeenCalledWith(
        'admin.ops-digest',
        expect.objectContaining({
          to: 'admin1@x.com',
          variables: expect.objectContaining({
            lowStockCount: 4,
            outOfStockCount: 2,
            newReturnsCount: 1,
            pendingReviewsCount: 3,
            adminUrl: 'https://admin.example.test',
          }),
          dedupeKey: expect.stringMatching(/^ops-digest:a-1:\d{4}-\d{2}-\d{2}$/),
        }),
      );
      expect(mail.enqueue).toHaveBeenCalledWith(
        'admin.ops-digest',
        expect.objectContaining({ to: 'admin2@x.com', locale: 'fr' }),
      );
    });
  });

  describe('kpi-digest', () => {
    const job = { name: 'kpi-digest' } as Job;

    it('computes a light KPI summary and enqueues one digest per admin', async () => {
      const { proc, prisma, mail } = makeMocks();
      prisma.order.aggregate.mockResolvedValue({ _sum: { total: 1000 }, _count: { _all: 8 } });
      prisma.user.count.mockResolvedValue(5);

      await proc.process(job);

      expect(mail.enqueue).toHaveBeenCalledWith(
        'admin.kpi-digest',
        expect.objectContaining({
          to: 'admin@x.com',
          variables: expect.objectContaining({
            // Display-formatted money: three-decimal LYD, the store's narrow
            // no-break space between thousands groups, and the symbol after
            // the number. Built from codepoints so a whitespace-normalising
            // tool cannot quietly turn either separator into a plain space and
            // leave the assertion still passing.
            revenue: `1${NARROW_NO_BREAK_SPACE}000,000${NO_BREAK_SPACE}LD`,
            orders: 8,
            aov: `125,000${NO_BREAK_SPACE}LD`,
            newCustomers: 5,
            periodLabel: 'the past 7 days',
          }),
          dedupeKey: expect.stringMatching(/^kpi-digest:a-1:\d+$/),
        }),
      );
      // The unit rides inside the formatted string now; a separate `currency`
      // variable is no longer emitted by any flow.
      const kpi = mail.enqueue.mock.calls.find((c) => c[0] === 'admin.kpi-digest');
      expect(kpi[1].variables).not.toHaveProperty('currency');
    });

    it('writes the French period label for a French admin, money unchanged by locale', async () => {
      const { proc, prisma, mail } = makeMocks();
      prisma.order.aggregate.mockResolvedValue({ _sum: { total: 1000 }, _count: { _all: 8 } });
      prisma.user.findMany.mockResolvedValue([{ id: 'a-1', email: 'admin@x.com', locale: 'fr' }]);

      await proc.process(job);

      const call = mail.enqueue.mock.calls.find((c) => c[0] === 'admin.kpi-digest');
      expect(call[1].locale).toBe('fr');
      expect(call[1].variables.periodLabel).toBe('la semaine écoulée');
      expect(call[1].variables.revenue).toBe(`1${NARROW_NO_BREAK_SPACE}000,000${NO_BREAK_SPACE}LD`);
    });

    it('guards AOV against a zero-order week', async () => {
      const { proc, prisma, mail } = makeMocks();
      prisma.order.aggregate.mockResolvedValue({ _sum: { total: 0 }, _count: { _all: 0 } });

      await proc.process(job);

      const call = mail.enqueue.mock.calls.find((c) => c[0] === 'admin.kpi-digest');
      expect(call[1].variables.aov).toBe(`0,000${NO_BREAK_SPACE}LD`);
    });
  });
});
