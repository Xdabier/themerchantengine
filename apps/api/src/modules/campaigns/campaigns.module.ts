/**
 * Campaigns module (NE9 — marketing / broadcast plane).
 *
 * Registers its OWN `campaign` + `campaign-winback` BullMQ queues (never the
 * transactional `mail` queue — Risk R9) and imports MailModule for the shared
 * provider seam (ResendClient), the suppression truth (SuppressionService), the
 * consent gate (NotificationPreferenceService), and MailService (the
 * newsletter.confirm transactional send).
 */
import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { MailModule } from '../mail/mail.module';
import { BotProtectionGuard } from '../../common/bot-protection';
import { CAMPAIGN_QUEUE, WINBACK_QUEUE } from './campaigns.constants';
import { CampaignService } from './campaign.service';
import { SubscriberService } from './subscriber.service';
import { CampaignProcessor } from './campaign.processor';
import { WinbackProcessor } from './winback.processor';
import { CampaignsController } from './campaigns.controller';
import { SubscribersController } from './subscribers.controller';
import { NewsletterController } from './newsletter.controller';

@Module({
  imports: [
    SettingsModule,
    ConfigModule,
    MailModule,
    BullModule.registerQueue({
      name: CAMPAIGN_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    }),
    BullModule.registerQueue({ name: WINBACK_QUEUE }),
  ],
  controllers: [CampaignsController, SubscribersController, NewsletterController],
  providers: [
    CampaignService,
    SubscriberService,
    CampaignProcessor,
    WinbackProcessor,
    BotProtectionGuard,
  ],
  exports: [CampaignService, SubscriberService],
})
export class CampaignsModule {}
