import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsAdminController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsListener } from './notifications.listener';
import { NotificationTemplatesController } from './notification-templates.controller';
import { NotificationTemplatesService } from './notification-templates.service';
import { MailModule } from '../mail/mail.module';

@Module({
  // MailModule exports MailService — the §3.1-compliant bridge the admin resend
  // crosses to re-dispatch through the genuine enqueue pipeline (NE2).
  imports: [SettingsModule, MailModule],
  controllers: [NotificationsAdminController, NotificationTemplatesController],
  providers: [NotificationsService, NotificationsListener, NotificationTemplatesService],
  exports: [NotificationsService, NotificationTemplatesService],
})
export class NotificationsModule {}
