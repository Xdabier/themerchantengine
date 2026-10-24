import { ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { WEBHOOK_EVENT_TYPES, WebhookEventType } from '../webhooks.constants';

export class CreateWebhookDto {
  /** Target HTTPS endpoint (validated against SSRF block-list at service layer). */
  @IsString()
  @Matches(/^https:\/\//, { message: 'url must use the HTTPS scheme' })
  url: string;

  /** One or more event types this subscription should receive. */
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(WEBHOOK_EVENT_TYPES, { each: true })
  events: WebhookEventType[];

  /**
   * HMAC-SHA256 signing secret.
   * Auto-generated when omitted (recommended).
   */
  @IsOptional()
  @IsString()
  secret?: string;
}
