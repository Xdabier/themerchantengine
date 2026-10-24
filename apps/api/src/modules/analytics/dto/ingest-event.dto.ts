import { IsEnabledLocaleValue } from '../../../common/dto/translatable-locale-keys.dto';
import { IsEnum, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ANALYTICS_EVENT_TYPES, type AnalyticsEventType } from '../analytics.constants';

export class IngestEventDto {
  @IsEnum(ANALYTICS_EVENT_TYPES)
  eventType: AnalyticsEventType;

  /** Browser/device session identifier. Safe alphanumeric + dash/underscore, max 128 chars. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  sessionId?: string;

  /** Authenticated user UUID, if known. */
  @IsOptional()
  @IsString()
  userId?: string;

  /** Product the event relates to. */
  @IsOptional()
  @IsString()
  productId?: string;

  /** Order ID for purchase events. */
  @IsOptional()
  @IsString()
  orderId?: string;

  /** Arbitrary event payload (cart value, search query, etc.). */
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  /** Locale in effect when the event fired: one the store has enabled, so an
   * unsupported code is rejected instead of persisted. */
  @IsOptional()
  @IsEnabledLocaleValue()
  locale?: string;
}
