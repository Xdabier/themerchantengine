/**
 * Mail module — registers the `mail` BullMQ queue + exports MailService.
 *
 * Imported in `app.module.ts` ABOVE the `AuthMailerProvider` provider entry
 * so Nest's topological init guarantees MailService is constructable when
 * the provider's constructor runs. PrismaModule is already `@Global()`
 * (`apps/api/src/prisma/prisma.module.ts:4`), so no explicit import needed.
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { SettingsModule } from '../settings/settings.module';
import { MailService } from './mail.service';
import { MailProcessor } from './mail.processor';
import { ResendClient } from './resend.client';
import { SuppressionService } from './suppression.service';
import { MailDispatchListener } from './dispatch/mail-dispatch.listener';
import { BackInStockListener } from './listeners/back-in-stock.listener';
import { ReviewRequestProcessor } from './scheduled/review-request.processor';
import { GiftCardExpiryProcessor } from './scheduled/gift-card-expiry.processor';
import { StaffDigestProcessor } from './scheduled/staff-digest.processor';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationPreferenceController } from './notification-preference.controller';
import { UnsubscribeController } from './unsubscribe.controller';
import { MAIL_QUEUE } from './mail.constants';
import {
  REVIEW_REQUEST_QUEUE,
  GIFT_CARD_EXPIRY_QUEUE,
  STAFF_DIGEST_QUEUE,
} from './scheduled/scheduled.constants';

@Module({
  imports: [
    ConfigModule,
    // The processor resolves the store name from the runtime config per send.
    SettingsModule,
    BullModule.registerQueue({
      name: MAIL_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    }),
    // NE8 scheduled / delayed producers — each enqueues onto MAIL_QUEUE in turn.
    BullModule.registerQueue({ name: REVIEW_REQUEST_QUEUE }),
    BullModule.registerQueue({ name: GIFT_CARD_EXPIRY_QUEUE }),
    BullModule.registerQueue({ name: STAFF_DIGEST_QUEUE }),
  ],
  controllers: [
    // Customer preference center + public one-click unsubscribe (NE7).
    NotificationPreferenceController,
    UnsubscribeController,
  ],
  providers: [
    MailService,
    MailProcessor,
    ResendClient,
    SuppressionService,
    // The single event→email bridge (NE4). Binds one EventEmitter2 listener per
    // DISPATCH_TABLE row. Adding a new flow = append a table row (+ resolver +
    // template default) — no new listener class.
    MailDispatchListener,
    // Back-in-stock fan-out (NE8) — listens on inventory.restocked, enqueues one
    // lifecycle email per wishlister (1→N, so not a DISPATCH_TABLE 1→1 row).
    BackInStockListener,
    // NE8 scheduled / delayed producers (BullMQ-only): delayed review-request off
    // order.delivered, daily gift-card expiry scan, daily ops + weekly KPI digests.
    ReviewRequestProcessor,
    GiftCardExpiryProcessor,
    StaffDigestProcessor,
    // Per-user/per-category consent (NE7) — injected into MailService for the
    // enqueue consent gate and into the controllers above.
    NotificationPreferenceService,
  ],
  exports: [
    MailService,
    SuppressionService,
    NotificationPreferenceService,
    // NE9 — the campaign plane (separate `campaigns` module) shares the provider
    // seam + the suppression truth, so export them. The campaign queue itself is
    // registered + owned by the campaigns module, never here (queue isolation).
    ResendClient,
  ],
})
export class MailModule {}
