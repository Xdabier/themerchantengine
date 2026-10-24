/**
 * Post-delivery review solicitation (NE8).
 *
 * Two responsibilities in one provider:
 *  1. @OnEvent(order.delivered) → schedule a DELAYED BullMQ job (+3 days) with a
 *     stable jobId so a re-fired delivery event never double-schedules.
 *  2. process() → after the delay, enqueue `review.request` ONLY when the
 *     customer still has an unreviewed item from that order. Idempotent per
 *     (userId, productId): already-reviewed products are filtered out, and the
 *     mail dedupeKey collapses a retried job to a single send.
 *
 * `review.request` is LIFECYCLE-class, so the MailService.enqueue consent gate
 * (NE7) decides per recipient whether it actually sends. Recipient + review data
 * is read via the mail module's injected PrismaService (§3.1).
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../mail.service';
import { resolveLocale } from '../listeners/locale.util';
import { buildOrderUrl } from '../dispatch/url.util';
import { ORDER_EVENTS } from '../../orders/orders.constants';
import {
  REVIEW_REQUEST_QUEUE,
  REVIEW_REQUEST_JOB,
  REVIEW_REQUEST_DELAY_MS,
} from './scheduled.constants';

interface DeliveredPayload {
  orderId: string;
  orderNumber?: string;
  userId?: string;
}

interface ReviewRequestJobData {
  orderId: string;
}

@Processor(REVIEW_REQUEST_QUEUE)
export class ReviewRequestProcessor extends WorkerHost {
  private readonly logger = new Logger(ReviewRequestProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    @InjectQueue(REVIEW_REQUEST_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  @OnEvent(ORDER_EVENTS.DELIVERED, { async: true })
  async onDelivered(payload: DeliveredPayload): Promise<void> {
    if (!payload?.orderId) return;
    try {
      await this.queue.add(
        REVIEW_REQUEST_JOB,
        { orderId: payload.orderId } as ReviewRequestJobData,
        {
          delay: REVIEW_REQUEST_DELAY_MS,
          // Stable jobId — a re-fired order.delivered never double-schedules.
          jobId: `review-request:${payload.orderId}`,
        },
      );
    } catch (err) {
      this.logger.error(
        `failed to schedule review-request for order ${payload.orderId}: ${(err as Error).message}`,
      );
    }
  }

  async process(job: Job<ReviewRequestJobData>): Promise<void> {
    const { orderId } = job.data;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        userId: true,
        user: { select: { email: true, locale: true } },
        items: { select: { productId: true } },
      },
    });
    if (!order?.user?.email || !order.userId) return;

    const productIds = [
      ...new Set(order.items.map((i) => i.productId).filter((p): p is string => !!p)),
    ];
    if (!productIds.length) return;

    // Idempotency per (userId, productId): never solicit a review for a product
    // the customer already reviewed.
    const reviewed = await this.prisma.review.findMany({
      where: { userId: order.userId, productId: { in: productIds } },
      select: { productId: true },
    });
    const reviewedSet = new Set(reviewed.map((r) => r.productId));
    if (productIds.every((p) => reviewedSet.has(p))) return; // all reviewed — no nag

    const locale = resolveLocale(order.user.locale);
    await this.mail.enqueue('review.request', {
      to: order.user.email,
      locale,
      variables: {
        orderNumber: order.orderNumber,
        reviewUrl: buildOrderUrl(this.config, locale, order.id),
      },
      // One solicitation per order; a retry of this delayed job dedupes.
      dedupeKey: `review-request:${orderId}`,
    });
  }
}
