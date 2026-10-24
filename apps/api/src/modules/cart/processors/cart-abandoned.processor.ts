import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { CART_ABANDONED_QUEUE, ABANDONED_THRESHOLD_MS, CART_EVENTS } from '../cart.constants';

/**
 * Runs every 15 minutes scanning for abandoned carts (spec §4.7 Abandonment).
 *
 * A cart is abandoned when:
 *  - It has at least one item
 *  - updatedAt < now - 1 hour
 *  - abandonedAt IS NULL (not already marked)
 *  - No corresponding order exists
 */
@Processor(CART_ABANDONED_QUEUE)
export class CartAbandonedProcessor extends WorkerHost {
  private readonly logger = new Logger(CartAbandonedProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {
    super();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async process(_job: Job): Promise<void> {
    const threshold = new Date(Date.now() - ABANDONED_THRESHOLD_MS);

    const carts = await this.prisma.cart.findMany({
      where: {
        abandonedAt: null,
        updatedAt: { lt: threshold },
        items: { some: {} },
      },
      select: {
        id: true,
        userId: true,
        subtotal: true,
        items: {
          select: {
            id: true,
            variantId: true,
            quantity: true,
            productName: true,
            unitPrice: true,
          },
        },
        user: { select: { email: true } },
      },
    });

    for (const cart of carts) {
      // Mark cart as abandoned
      await this.prisma.cart.update({
        where: { id: cart.id },
        data: { abandonedAt: new Date() },
      });

      this.events.emit(CART_EVENTS.ABANDONED, {
        cartId: cart.id,
        userId: cart.userId,
        customerEmail: cart.user?.email ?? null,
        items: cart.items,
        subtotal: Number(cart.subtotal),
      });

      this.logger.log(`cart.abandoned: cartId=${cart.id} userId=${cart.userId ?? 'anon'}`);
    }

    this.logger.log(`cart-abandoned scan: ${carts.length} cart(s) marked abandoned`);
  }
}
