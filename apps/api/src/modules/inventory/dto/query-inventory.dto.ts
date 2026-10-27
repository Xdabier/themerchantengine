import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { MovementType } from '@prisma/client';
import {
  VALID_MOVEMENT_SORT_FIELDS,
  VALID_STOCK_SORT_FIELDS,
  ValidMovementSortField,
  ValidStockSortField,
} from '../inventory.constants';

export class ListStockLevelsAdminDto {
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
  @IsNotEmpty()
  variantId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  locationId?: string;

  @IsOptional()
  @IsEnum(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'])
  stockStatus?: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

  @IsOptional()
  @IsEnum(VALID_STOCK_SORT_FIELDS)
  sortBy?: ValidStockSortField;

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class ListMovementsAdminDto {
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
  @IsNotEmpty()
  variantId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  locationId?: string;

  @IsOptional()
  @IsEnum(MovementType)
  type?: MovementType;

  /** ISO 8601 date string — inclusive lower bound on createdAt */
  @IsOptional()
  @IsString()
  dateFrom?: string;

  /** ISO 8601 date string — inclusive upper bound on createdAt */
  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @IsEnum(VALID_MOVEMENT_SORT_FIELDS)
  sortBy?: ValidMovementSortField;

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
