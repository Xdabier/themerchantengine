import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CMS_DEFAULT_PAGE_SIZE, CMS_MAX_PAGE_SIZE } from '../cms.constants';

export class ListPagesAdminDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CMS_MAX_PAGE_SIZE)
  pageSize?: number = CMS_DEFAULT_PAGE_SIZE;
}
