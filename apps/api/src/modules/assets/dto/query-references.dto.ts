import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ASSET_REFERENCE_KINDS, type AssetReferenceKind } from '../assets.types';

/**
 * Query string for `GET /v1/admin/assets/:id/references`. Pagination
 * parameters are accepted for forward-compat (S20+ may surface high-cardinality
 * `StorefrontSection.config` references) — S18 returns the full list.
 */
export class GetAssetReferencesDto {
  @IsOptional()
  @IsEnum(ASSET_REFERENCE_KINDS)
  type?: AssetReferenceKind;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}
