import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AssetStatus, AssetType } from '@prisma/client';

export class ListAssetsDto {
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

  @IsEnum(AssetType)
  @IsOptional()
  type?: AssetType;

  @IsEnum(AssetStatus)
  @IsOptional()
  status?: AssetStatus;

  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;
}
