import { IsEnum, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ReturnReason, ReturnStatus } from '@prisma/client';

export class ListReturnsStorefrontDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export class ListReturnsAdminDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  pageSize?: number;

  @IsOptional()
  @IsEnum(ReturnStatus)
  status?: ReturnStatus;

  @IsOptional()
  @IsEnum(ReturnReason)
  reason?: ReturnReason;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @Matches(/^(asc|desc)$/i)
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;
}

export class ReturnsAnalyticsQueryDto {
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;
}
