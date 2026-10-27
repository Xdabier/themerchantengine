import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { WEBHOOKS_DEFAULT_PAGE_SIZE, WEBHOOKS_MAX_PAGE_SIZE } from '../webhooks.constants';

export class ListWebhooksDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(WEBHOOKS_MAX_PAGE_SIZE)
  pageSize?: number = WEBHOOKS_DEFAULT_PAGE_SIZE;
}
