import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
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
 * Category + Product IDs use Prisma's default `cuid()` (see `prisma/schema.prisma`
 * `Category.id` / `Product.id`). Mirror the shape of `entityIdSchema` in
 * `libs/admin-types/src/ids.ts`: 1–64 chars, [A-Za-z0-9_-]. Tighter than a
 * generic `@IsString()` and safe across cuid / cuid2 / future variants.
 */
const ENTITY_ID_REGEX = /^[A-Za-z0-9_-]+$/;

/**
 * Per-type config for `SectionType.CATEGORY_SHOWCASE`. Drives
 * `CategoriesGridComponent` per DR-05. References category rows by id; the
 * resolution step at storefront read time hydrates each id into the public
 * category shape.
 *
 * Bounds: at least one category, at most twelve — the v1 grid breakpoints
 * top out at eight columns × one row plus four wraparound at xl, beyond
 * which the section visually loses cohesion.
 */
export class CategoryShowcaseConfigDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(64, { each: true })
  @Matches(ENTITY_ID_REGEX, { each: true, message: 'categoryIds must be valid entity ids' })
  categoryIds: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  heading?: TranslatableDto;
}

/** JSON paths on `StorefrontSection.config` that hold `assetId` strings. */
export const CATEGORY_SHOWCASE_ASSET_ID_PATHS: ReadonlyArray<readonly string[]> = [];
