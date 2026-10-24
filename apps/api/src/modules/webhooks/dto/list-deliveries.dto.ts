import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DELIVERIES_DEFAULT_PAGE_SIZE, DELIVERIES_MAX_PAGE_SIZE } from '../webhooks.constants';

export class ListDeliveriesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(DELIVERIES_MAX_PAGE_SIZE)
  pageSize?: number = DELIVERIES_DEFAULT_PAGE_SIZE;
}
