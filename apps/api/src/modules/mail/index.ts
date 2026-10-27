export { MailModule } from './mail.module';
export { MailService } from './mail.service';
export { ResendClient } from './resend.client';
export { SuppressionService } from './suppression.service';
export { validateMailEnv, type MailEnv } from './config/mail.env';
export type {
  MailJobName,
  MailJobPayload,
  MailLocale,
  MailEnqueueInput,
  MailEnqueueResult,
  RenderedTemplate,
} from './mail.types';
export {
  MAIL_QUEUE,
  RESEND_PROVIDER,
  NOTIFICATION_CHANNEL_EMAIL,
  type NotificationLogStatus,
} from './mail.constants';
