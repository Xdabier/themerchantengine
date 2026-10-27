import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum CustomerSegment {
  NEW = 'NEW',
  ACTIVE = 'ACTIVE',
  LOYAL = 'LOYAL',
  AT_RISK = 'AT_RISK',
  CHURNED = 'CHURNED',
  HIGH_VALUE = 'HIGH_VALUE',
  VIP = 'VIP',
}

export class ListCustomersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(CustomerSegment)
  segment?: CustomerSegment;
}
