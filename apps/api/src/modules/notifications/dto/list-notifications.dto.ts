import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { NOTIFICATIONS_MAX_PAGE_SIZE } from '../notifications.constants';

export class ListNotificationsDto {
  @IsOptional()
  @IsBoolean()
  // A query param arrives as a string; `@Type(() => Boolean)` would coerce any
  // non-empty string (including "false") to `true`. Parse the literal instead.
  @Transform(({ value }) => value === 'true' || value === true)
  isRead?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATIONS_MAX_PAGE_SIZE)
  pageSize?: number;
}
