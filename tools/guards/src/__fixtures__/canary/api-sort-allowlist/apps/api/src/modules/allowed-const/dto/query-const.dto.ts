// Canary fixture. Never imported by application code.
import { IsOptional, IsString } from 'class-validator';

export class QueryConstDto {
  @IsOptional()
  @IsString()
  sortBy?: string;
}
