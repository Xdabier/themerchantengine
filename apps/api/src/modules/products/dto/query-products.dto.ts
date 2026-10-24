import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ProductStatus } from '@prisma/client';
import { MONEY_DECIMAL_PLACES } from '@common/money';

export class ListProductsAdminDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  pageSize?: number;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  productTypeId?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isFeatured?: boolean;

  @IsOptional()
  @IsString()
  search?: string;
}

export class ListProductsStorefrontDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  pageSize?: number;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @IsString()
  categoryId?: string;

  /**
   * Comma-separated product ids — fetch this exact set (used by the storefront
   * home loader to hydrate curated FEATURED_PRODUCTS rails by id). Capped at
   * 100 ids server-side; order of the response is not guaranteed (the caller
   * re-orders by its own list).
   */
  @IsOptional()
  @IsString()
  ids?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  /**
   * Comma-separated `facet:value` tags. Values within one facet OR, facets AND.
   *
   * Bounded and pattern-checked because this is a public endpoint and the field
   * previously accepted an unbounded string.
   */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(/^[a-z0-9-]+:[a-z0-9-]+(,[a-z0-9-]+:[a-z0-9-]+)*$/, {
    message: 'tags must be a comma-separated list of facet:value tokens',
  })
  tags?: string;

  /**
   * Comma-separated `specKey:valueKey` pairs, matched against the normalised
   * ProductSpec columns rather than display text, so a filter resolves the same
   * way in both locales. Values within one spec OR, specs AND.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  @Matches(/^[a-z0-9-]+:[a-z0-9-]+(,[a-z0-9-]+:[a-z0-9-]+)*$/, {
    message: 'specs must be a comma-separated list of key:value tokens',
  })
  specs?: string;

  // Money, not a count: the catalogue price bands send millime-precision
  // bounds, and @IsInt() 400s on every one of them.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Type(() => Number)
  minPrice?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Type(() => Number)
  maxPrice?: number;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isFeatured?: boolean;
}

/**
 * Query for `GET /v1/products/brands`.
 *
 * Only the category scope: the rail asks for the brands of the catalogue it is
 * showing, and every other filter is deliberately absent so the brand list does
 * not shrink to the current selection (finding C11).
 */
export class ListBrandFacetsDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string;
}
