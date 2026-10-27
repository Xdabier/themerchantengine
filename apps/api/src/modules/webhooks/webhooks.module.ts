import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { BullModule } from '@nestjs/bullmq';
import { SeoModule } from '../seo/seo.module';
import { SEO_SITEMAP_QUEUE } from '../seo/seo.constants';
import { MailModule } from '../mail';
import { WebhooksAdminController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhooksListener } from './webhooks.listener';
import { RevalidationListener } from './revalidation.listener';
import { WebhookDeliveryProcessor } from './processors/webhook-delivery.processor';
import { ProcessedWebhookService } from './processed-webhook.service';
import { ResendWebhookController } from './resend-webhook.controller';
import { ResendWebhookService } from './resend-webhook.service';
import { WEBHOOK_DELIVERY_QUEUE } from './webhooks.constants';

@Module({
  imports: [
    SettingsModule,
    BullModule.registerQueue({ name: WEBHOOK_DELIVERY_QUEUE }),
    // Re-register the SEO sitemap queue here so the RevalidationListener can
    // inject it via @InjectQueue(SEO_SITEMAP_QUEUE). BullMQ deduplicates by
    // queue name; both modules share the same queue instance.
    BullModule.registerQueue({ name: SEO_SITEMAP_QUEUE }),
    // SeoModule exports SearchEngineSubmitService for the RevalidationListener
    // event-driven IndexNow submission per DR-10.
    SeoModule,
    // ResendWebhookService consumes SuppressionService (mail module export).
    MailModule,
  ],
  controllers: [WebhooksAdminController, ResendWebhookController],
  providers: [
    WebhooksService,
    WebhooksListener,
    RevalidationListener,
    WebhookDeliveryProcessor,
    ProcessedWebhookService,
    ResendWebhookService,
  ],
  exports: [WebhooksService, ProcessedWebhookService],
})
export class WebhooksModule {}
