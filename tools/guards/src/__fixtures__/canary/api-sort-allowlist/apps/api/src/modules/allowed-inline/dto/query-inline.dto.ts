// Canary fixture. Never imported by application code.
import { IsIn, IsOptional } from 'class-validator';

export class QueryInlineDto {
  @IsOptional()
  @IsIn(['createdAt', 'name'])
  sortBy?: string;
}
