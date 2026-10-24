import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { VALID_ANALYTICS_PERIODS } from '../search.constants';

export class SearchAnalyticsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsIn(VALID_ANALYTICS_PERIODS)
  period?: number = 30;

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
}
