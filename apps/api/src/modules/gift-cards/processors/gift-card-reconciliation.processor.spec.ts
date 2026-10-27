import { Job } from 'bullmq';
import { GiftCardReconciliationProcessor } from './gift-card-reconciliation.processor';

// Closes a pre-existing coverage gap surfaced by the NE8 test-coverage census:
// the reconciliation processor shipped with no spec before this phase.

function makeMocks() {
  const prisma = { giftCard: { findMany: jest.fn().mockResolvedValue([]) } };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const proc = new GiftCardReconciliationProcessor(prisma as never, queue as never);
  return { prisma, queue, proc };
}

const JOB = {} as Job;

describe('GiftCardReconciliationProcessor', () => {
  it('registers a daily cron with a stable jobId', async () => {
    const { proc, queue } = makeMocks();
    await proc.onModuleInit();
    expect(queue.add).toHaveBeenCalledWith(
      'reconcile',
      {},
      { repeat: { pattern: '0 4 * * *' }, jobId: 'gift-card-reconciliation-cron' },
    );
  });

  it('passes when every balance equals initial + sum(transactions)', async () => {
    const { proc, prisma } = makeMocks();
    prisma.giftCard.findMany.mockResolvedValue([
      {
        id: 'gc-1',
        code: 'A',
        initialBalance: 100,
        currentBalance: 70,
        transactions: [{ amount: -30 }],
      },
      { id: 'gc-2', code: 'B', initialBalance: 50, currentBalance: 50, transactions: [] },
    ]);
    await expect(proc.process(JOB)).resolves.toBeUndefined();
  });

  it('throws when a balance mismatch is detected (drift beyond tolerance)', async () => {
    const { proc, prisma } = makeMocks();
    prisma.giftCard.findMany.mockResolvedValue([
      {
        id: 'gc-1',
        code: 'A',
        initialBalance: 100,
        currentBalance: 90,
        transactions: [{ amount: -30 }],
      },
    ]);
    await expect(proc.process(JOB)).rejects.toThrow(/mismatch/i);
  });

  it('tolerates floating-point drift within 0.01', async () => {
    const { proc, prisma } = makeMocks();
    prisma.giftCard.findMany.mockResolvedValue([
      {
        id: 'gc-1',
        code: 'A',
        initialBalance: 10.1,
        currentBalance: 10.2,
        transactions: [{ amount: 0.1 }],
      },
    ]);
    await expect(proc.process(JOB)).resolves.toBeUndefined();
  });
});
