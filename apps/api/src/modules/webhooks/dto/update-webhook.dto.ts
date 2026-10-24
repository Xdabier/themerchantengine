import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateWebhookDto } from './create-webhook.dto';

export class UpdateWebhookDto extends PartialType(OmitType(CreateWebhookDto, ['secret'] as const)) {
  /** Manually re-activate a previously deactivated subscription. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
