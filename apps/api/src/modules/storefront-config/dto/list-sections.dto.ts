import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { SECTION_DEFAULT_PAGE_SIZE, SECTION_MAX_PAGE_SIZE } from '../storefront-config.constants';

export class ListSectionsAdminDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SECTION_MAX_PAGE_SIZE)
  pageSize?: number = SECTION_DEFAULT_PAGE_SIZE;
}
