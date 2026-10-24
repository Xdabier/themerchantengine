import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TranslatableDto } from '../translatable.dto';

/**
 * Product IDs use Prisma's default `cuid()` (see `prisma/schema.prisma` —
 * `Product.id String @id @default(cuid())`). Mirror the shape of
 * `entityIdSchema` in `libs/admin-types/src/ids.ts`.
 */
const ENTITY_ID_REGEX = /^[A-Za-z0-9_-]+$/;

export const FEATURED_PRODUCTS_VARIANTS = ['scroll', 'grid'] as const;
export type FeaturedProductsVariant = (typeof FEATURED_PRODUCTS_VARIANTS)[number];

/**
 * Per-type config for `SectionType.FEATURED_PRODUCTS`. Drives
 * `ProductRailComponent` per DR-05. Selects a curated product list and the
 * presentation variant (`scroll` rail vs `grid`).
 *
 * Bounds: at least one product, at most twelve — keeps a single rail
 * snappable on mobile and a single grid on desktop without paging.
 */
export class FeaturedProductsConfigDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(64, { each: true })
  @Matches(ENTITY_ID_REGEX, { each: true, message: 'productIds must be valid entity ids' })
  productIds: string[];

  @IsIn(FEATURED_PRODUCTS_VARIANTS)
  variant: FeaturedProductsVariant;

  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  heading?: TranslatableDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  eyebrow?: TranslatableDto;
}

/** JSON paths on `StorefrontSection.config` that hold `assetId` strings. */
export const FEATURED_PRODUCTS_ASSET_ID_PATHS: ReadonlyArray<readonly string[]> = [];
