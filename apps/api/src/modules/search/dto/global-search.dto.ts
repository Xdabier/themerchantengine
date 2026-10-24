import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export const GLOBAL_SEARCH_TYPES = ['product', 'order', 'customer', 'cms'] as const;
export type GlobalSearchType = (typeof GLOBAL_SEARCH_TYPES)[number];

export class GlobalSearchDto {
  @IsString()
  @MinLength(2)
  q!: string;

  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(GLOBAL_SEARCH_TYPES.length)
  @IsIn(GLOBAL_SEARCH_TYPES, { each: true })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
        : undefined,
  )
  types?: GlobalSearchType[];

  @IsInt()
  @Min(1)
  @Max(20)
  @IsOptional()
  @Transform(({ value }) => Number(value))
  limit?: number;
}
