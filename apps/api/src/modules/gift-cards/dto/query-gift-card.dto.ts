import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class ListGiftCardsAdminDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  /** Filter by recipient email (partial match not supported — exact only). */
  @IsOptional()
  @IsString()
  recipientEmail?: string;

  /** Filter by purchasedBy user ID. Pass "null" as string to list store-credit cards. */
  @IsOptional()
  @IsString()
  purchasedBy?: string;

  @IsOptional()
  @Transform(({ value }: { value: string }) => value === 'true')
  @IsBoolean()
  isActive?: boolean;

  /** Sort field — validated against allowlist in service. */
  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}
