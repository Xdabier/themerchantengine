import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { TEMPLATE_CHANNELS, type TemplateChannel } from './template.dto';

// Mirrors NotificationLogStatus (mail.constants.ts) so an operator can filter
// the send-log by any status the pipeline can write — including `queued`,
// `suppressed`, `complained`, the `skipped` value added in NE1, and the
// `enqueue-failed` value added in NE4 (Risk R10).
export const LOG_STATUSES = [
  'queued',
  'sent',
  'delivered',
  'bounced',
  'complained',
  'failed',
  'suppressed',
  'skipped',
  'enqueue-failed',
] as const;
export type LogStatus = (typeof LOG_STATUSES)[number];

export class ListLogDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  @Transform(({ value }) => Number(value))
  page?: number;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Transform(({ value }) => Number(value))
  pageSize?: number;

  @IsIn(TEMPLATE_CHANNELS)
  @IsOptional()
  channel?: TemplateChannel;

  @IsIn(LOG_STATUSES)
  @IsOptional()
  status?: LogStatus;

  @IsString()
  @IsOptional()
  templateCode?: string;

  @IsString()
  @IsOptional()
  recipient?: string;

  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;
}
