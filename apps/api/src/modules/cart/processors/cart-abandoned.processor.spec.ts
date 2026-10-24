import type { Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { CartAbandonedProcessor } from './cart-abandoned.processor';
import { CART_EVENTS } from '../cart.constants';

const job = {} as unknown as Job;

describe('CartAbandonedProcessor', () => {
  let processor: CartAbandonedProcessor;
  let prisma: { cart: { findMany: jest.Mock; update: jest.Mock } };
  let events: { emit: jest.Mock };

  beforeEach(() => {
    prisma = {
      cart: { findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    };
    events = { emit: jest.fn() };
    processor = new CartAbandonedProcessor(
      prisma as unknown as PrismaService,
      events as unknown as EventEmitter2,
    );
  });

  it('marks each abandoned cart and emits cart.abandoned with the recovery payload', async () => {
    prisma.cart.findMany.mockResolvedValue([
      {
        id: 'cart-1',
        userId: 'u1',
        subtotal: 120,
        items: [
          { id: 'i1', variantId: 'v1', quantity: 2, productName: { en: 'X' }, unitPrice: 60 },
        ],
        user: { email: 'shopper@example.com' },
      },
    ]);

    await processor.process(job);

    expect(prisma.cart.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cart-1' },
        data: expect.objectContaining({ abandonedAt: expect.any(Date) }),
      }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      CART_EVENTS.ABANDONED,
      expect.objectContaining({
        cartId: 'cart-1',
        userId: 'u1',
        customerEmail: 'shopper@example.com',
        subtotal: 120,
      }),
    );
  });

  it('emits a null customerEmail for an anonymous cart (the resolver skips it downstream)', async () => {
    prisma.cart.findMany.mockResolvedValue([
      { id: 'cart-2', userId: null, subtotal: 50, items: [{ id: 'i1', quantity: 1 }], user: null },
    ]);

    await processor.process(job);

    expect(events.emit).toHaveBeenCalledWith(
      CART_EVENTS.ABANDONED,
      expect.objectContaining({ customerEmail: null, userId: null }),
    );
  });

  it('emits nothing when there are no abandoned carts', async () => {
    prisma.cart.findMany.mockResolvedValue([]);

    await processor.process(job);

    expect(events.emit).not.toHaveBeenCalled();
  });
});
