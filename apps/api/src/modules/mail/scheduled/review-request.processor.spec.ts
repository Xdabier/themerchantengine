import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { ReviewRequestProcessor } from './review-request.processor';
import { REVIEW_REQUEST_DELAY_MS } from './scheduled.constants';

function makeMocks() {
  const prisma = {
    order: { findUnique: jest.fn() },
    review: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const mail = { enqueue: jest.fn().mockResolvedValue({ logId: 'l1', suppressed: false }) };
  const config = {
    get: jest.fn().mockReturnValue('https://storefront.example.test'),
  } as unknown as ConfigService;
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const proc = new ReviewRequestProcessor(prisma as never, mail as never, config, queue as never);
  return { prisma, mail, config, queue, proc };
}

const ORDER = {
  id: 'o-1',
  orderNumber: 'ORD-1001',
  userId: 'u-1',
  user: { email: 'c@x.com', locale: 'en' },
  items: [{ productId: 'p-1' }, { productId: 'p-2' }],
};

describe('ReviewRequestProcessor (NE8)', () => {
  describe('onDelivered (scheduling)', () => {
    it('schedules a delayed job with the configured delay + a stable jobId', async () => {
      const { proc, queue } = makeMocks();
      await proc.onDelivered({ orderId: 'o-1', orderNumber: 'ORD-1001', userId: 'u-1' });
      expect(queue.add).toHaveBeenCalledWith(
        'request',
        { orderId: 'o-1' },
        { delay: REVIEW_REQUEST_DELAY_MS, jobId: 'review-request:o-1' },
      );
    });

    it('does nothing without an orderId', async () => {
      const { proc, queue } = makeMocks();
      await proc.onDelivered({ orderId: '' });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('never throws out of the scheduler (swallows a queue failure)', async () => {
      const { proc, queue } = makeMocks();
      queue.add.mockRejectedValue(new Error('redis down'));
      await expect(proc.onDelivered({ orderId: 'o-1' })).resolves.toBeUndefined();
    });
  });

  describe('process (delayed handler)', () => {
    const job = { data: { orderId: 'o-1' } } as Job<{ orderId: string }>;

    it('enqueues review.request when an unreviewed item remains', async () => {
      const { proc, prisma, mail } = makeMocks();
      prisma.order.findUnique.mockResolvedValue(ORDER);
      prisma.review.findMany.mockResolvedValue([{ productId: 'p-1' }]); // only p-1 reviewed

      await proc.process(job);

      expect(mail.enqueue).toHaveBeenCalledWith(
        'review.request',
        expect.objectContaining({
          to: 'c@x.com',
          locale: 'en',
          variables: {
            orderNumber: 'ORD-1001',
            reviewUrl: 'https://storefront.example.test/en/account/orders/o-1',
          },
          dedupeKey: 'review-request:o-1',
        }),
      );
    });

    it('does NOT enqueue when every product is already reviewed (idempotent per user+product)', async () => {
      const { proc, prisma, mail } = makeMocks();
      prisma.order.findUnique.mockResolvedValue(ORDER);
      prisma.review.findMany.mockResolvedValue([{ productId: 'p-1' }, { productId: 'p-2' }]);
      await proc.process(job);
      expect(mail.enqueue).not.toHaveBeenCalled();
    });

    it('skips an order with no customer email', async () => {
      const { proc, prisma, mail } = makeMocks();
      prisma.order.findUnique.mockResolvedValue({ ...ORDER, user: { email: null, locale: 'en' } });
      await proc.process(job);
      expect(mail.enqueue).not.toHaveBeenCalled();
    });

    it('skips an order with no product items', async () => {
      const { proc, prisma, mail } = makeMocks();
      prisma.order.findUnique.mockResolvedValue({ ...ORDER, items: [] });
      await proc.process(job);
      expect(mail.enqueue).not.toHaveBeenCalled();
    });
  });
});
