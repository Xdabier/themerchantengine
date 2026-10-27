import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { IdempotencyService } from '../../common/idempotency.service';
import {
  IdempotencyKeyConflictException,
  IdempotencyKeyForbiddenException,
} from '../../common/exceptions/idempotency.exception';
import {
  WEBHOOK_DELIVERY_JOB,
  WEBHOOK_DELIVERY_QUEUE,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_PAYLOAD_VERSION,
  WebhookEventType,
} from './webhooks.constants';
import { generateSecret, validateWebhookUrl } from './webhooks.utils';
import { CreateWebhookDto, ListDeliveriesDto, ListWebhooksDto, UpdateWebhookDto } from './dto';

// ── Job payload shape ─────────────────────────────────────────────────────────

export interface WebhookDeliveryJobData {
  subscriptionId: string;
  deliveryId: string;
  eventId: string;
  eventType: string;
  occurredAt: string; // ISO-8601
  data: unknown;
  attempt: number;
}

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE) private readonly queue: Queue,
    private readonly idempotency: IdempotencyService,
  ) {}

  // ── Subscription CRUD ───────────────────────────────────────────────────────

  async createSubscription(dto: CreateWebhookDto) {
    validateWebhookUrl(dto.url);

    const secret = dto.secret ?? generateSecret();

    const subscription = await this.prisma.webhookSubscription.create({
      data: {
        url: dto.url,
        events: dto.events,
        secret,
        isActive: true,
        failureCount: 0,
      },
    });

    this.logger.log(`createSubscription: id=${subscription.id} url=${dto.url}`);
    return subscription;
  }

  async listSubscriptions(dto: ListWebhooksDto) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.webhookSubscription.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        // Never expose the secret in list responses
        select: {
          id: true,
          url: true,
          events: true,
          isActive: true,
          failureCount: true,
          lastDeliveredAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.webhookSubscription.count(),
    ]);

    return { data: items, meta: { page, pageSize, total } };
  }

  async getSubscription(id: string) {
    const sub = await this.prisma.webhookSubscription.findUnique({
      where: { id },
      select: {
        id: true,
        url: true,
        events: true,
        isActive: true,
        failureCount: true,
        lastDeliveredAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!sub)
      throw new NotFoundException({
        code: 'WEBHOOK_NOT_FOUND',
        message: 'Webhook subscription not found',
      });
    return sub;
  }

  async updateSubscription(id: string, dto: UpdateWebhookDto) {
    await this.getSubscription(id); // 404 guard

    if (dto.url) validateWebhookUrl(dto.url);

    const updated = await this.prisma.webhookSubscription.update({
      where: { id },
      data: {
        ...(dto.url !== undefined && { url: dto.url }),
        ...(dto.events !== undefined && { events: dto.events }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    this.logger.log(`updateSubscription: id=${id}`);
    return updated;
  }

  async deleteSubscription(id: string): Promise<void> {
    await this.getSubscription(id); // 404 guard
    await this.prisma.webhookSubscription.delete({ where: { id } });
    this.logger.log(`deleteSubscription: id=${id}`);
  }

  // ── Test delivery ────────────────────────────────────────────────────────────

  async sendTestEvent(id: string, adminId: string, idempotencyKey: string) {
    const callerHash = IdempotencyService.sha256Hex(adminId);
    // POST /v1/admin/webhooks/:id/test has no request body — bind the
    // body hash to the subscription id so the same admin can retry with
    // the same key safely against the same subscription, but a different
    // subscription target trips the body-fingerprint guard.
    const bodyHash = IdempotencyService.sha256Hex(IdempotencyService.stableStringify({ id }));
    const idempotencyArgs = {
      scope: 'webhooks-test',
      key: idempotencyKey,
      callerHash,
      bodyHash,
    };
    const begin = await this.idempotency.beginRequest(idempotencyArgs);
    switch (begin.state) {
      case 'cached':
        return begin.cachedResponse;
      case 'forbidden':
        throw new IdempotencyKeyForbiddenException();
      case 'conflict':
        throw new IdempotencyKeyConflictException();
      case 'in-flight':
        throw new IdempotencyKeyConflictException();
      case 'fresh':
        break;
    }

    try {
      const sub = await this.prisma.webhookSubscription.findUnique({ where: { id } });
      if (!sub)
        throw new NotFoundException({
          code: 'WEBHOOK_NOT_FOUND',
          message: 'Webhook subscription not found',
        });

      const eventType: WebhookEventType =
        (sub.events[0] as WebhookEventType) ?? WEBHOOK_EVENT_TYPES[0];
      const eventId = randomUUID();
      const occurredAt = new Date().toISOString();

      const delivery = await this.prisma.webhookDelivery.create({
        data: {
          subscriptionId: id,
          eventType,
          eventId,
          payload: {
            eventId,
            eventType,
            occurredAt,
            data: { test: true },
            version: WEBHOOK_PAYLOAD_VERSION,
          },
          attempt: 1,
        },
      });

      await this.queue.add(
        WEBHOOK_DELIVERY_JOB,
        {
          subscriptionId: id,
          deliveryId: delivery.id,
          eventId,
          eventType,
          occurredAt,
          data: { test: true },
          attempt: 1,
        } satisfies WebhookDeliveryJobData,
        { attempts: 1 },
      );

      this.logger.log(`sendTestEvent: subscriptionId=${id} eventId=${eventId}`);

      const response = { eventId, deliveryId: delivery.id };
      await this.idempotency.completeRequest({
        ...idempotencyArgs,
        entityId: delivery.id,
        responseJson: response,
      });
      return response;
    } catch (err) {
      await this.idempotency.abortRequest({
        scope: idempotencyArgs.scope,
        key: idempotencyKey,
        callerHash,
      });
      throw err;
    }
  }

  // ── Delivery log ─────────────────────────────────────────────────────────────

  async listDeliveries(subscriptionId: string, dto: ListDeliveriesDto) {
    await this.getSubscription(subscriptionId); // 404 guard

    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.webhookDelivery.findMany({
        where: { subscriptionId },
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.webhookDelivery.count({ where: { subscriptionId } }),
    ]);

    return { data: items, meta: { page, pageSize, total } };
  }

  // ── Dispatch (called by listener) ────────────────────────────────────────────

  /**
   * Finds all active subscriptions that listen to `eventType` and enqueues
   * one delivery job per subscription.
   */
  async dispatchEvent(eventType: string, data: unknown): Promise<void> {
    const subscriptions = await this.prisma.webhookSubscription.findMany({
      where: { isActive: true, events: { has: eventType } },
      select: { id: true },
    });

    if (subscriptions.length === 0) return;

    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();

    await Promise.all(
      subscriptions.map(async ({ id }) => {
        const delivery = await this.prisma.webhookDelivery.create({
          data: {
            subscriptionId: id,
            eventType,
            eventId,
            payload: { eventId, eventType, occurredAt, data, version: WEBHOOK_PAYLOAD_VERSION },
            attempt: 1,
          },
        });

        await this.queue.add(
          WEBHOOK_DELIVERY_JOB,
          {
            subscriptionId: id,
            deliveryId: delivery.id,
            eventId,
            eventType,
            occurredAt,
            data,
            attempt: 1,
          } satisfies WebhookDeliveryJobData,
          { attempts: 1 }, // Retries are scheduled manually to use exact delays
        );
      }),
    );

    this.logger.log(
      `dispatchEvent: type=${eventType} subscriptions=${subscriptions.length} eventId=${eventId}`,
    );
  }

  // ── Internal helpers (called by processor) ──────────────────────────────────

  async recordDeliverySuccess(
    deliveryId: string,
    subscriptionId: string,
    responseStatus: number,
    responseBody: string,
  ): Promise<void> {
    await Promise.all([
      this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          responseStatus,
          responseBody,
          succeededAt: new Date(),
          failedAt: null,
          nextRetryAt: null,
        },
      }),
      this.prisma.webhookSubscription.update({
        where: { id: subscriptionId },
        data: { failureCount: 0, lastDeliveredAt: new Date() },
      }),
    ]);
  }

  async recordDeliveryFailure(
    deliveryId: string,
    responseStatus: number | null,
    responseBody: string,
    nextRetryAt: Date | null,
  ): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        responseStatus,
        responseBody,
        failedAt: new Date(),
        nextRetryAt,
      },
    });
  }

  /**
   * Schedules the next retry attempt by creating a new WebhookDelivery record
   * and enqueuing a delayed job.
   */
  async scheduleRetry(
    originalJobData: WebhookDeliveryJobData,
    delayMs: number,
    nextAttempt: number,
  ): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        subscriptionId: originalJobData.subscriptionId,
        eventType: originalJobData.eventType,
        eventId: originalJobData.eventId,
        payload: {
          eventId: originalJobData.eventId,
          eventType: originalJobData.eventType,
          occurredAt: originalJobData.occurredAt,
          data: originalJobData.data,
          version: WEBHOOK_PAYLOAD_VERSION,
        },
        attempt: nextAttempt,
        nextRetryAt: new Date(Date.now() + delayMs),
      },
    });

    await this.queue.add(
      WEBHOOK_DELIVERY_JOB,
      {
        ...originalJobData,
        deliveryId: delivery.id,
        attempt: nextAttempt,
      } satisfies WebhookDeliveryJobData,
      { delay: delayMs, attempts: 1 },
    );
  }

  /** Increments failureCount; deactivates the subscription when the threshold is reached. */
  async handleDeliveryExhausted(subscriptionId: string): Promise<void> {
    const updated = await this.prisma.webhookSubscription.update({
      where: { id: subscriptionId },
      data: { failureCount: { increment: 1 } },
    });

    this.logger.warn(
      `handleDeliveryExhausted: subscriptionId=${subscriptionId} failureCount=${updated.failureCount}`,
    );

    if (updated.failureCount >= 5) {
      await this.deactivateSubscription(subscriptionId);
    }
  }

  async deactivateSubscription(subscriptionId: string): Promise<void> {
    await this.prisma.webhookSubscription.update({
      where: { id: subscriptionId },
      data: { isActive: false },
    });
    this.logger.warn(
      `deactivateSubscription: subscriptionId=${subscriptionId} — too many failures`,
    );
  }

  // ── Inbound deduplication (spec §9.5 I2) ─────────────────────────────────────

  async isEventProcessed(provider: string, externalEventId: string): Promise<boolean> {
    const existing = await this.prisma.processedWebhook.findUnique({
      where: { provider_externalEventId: { provider, externalEventId } },
    });
    return existing !== null;
  }

  async markEventProcessed(provider: string, externalEventId: string): Promise<void> {
    await this.prisma.processedWebhook.create({
      data: { provider, externalEventId },
    });
  }
}
