import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AUDIT_LOG_MAX_PAGE_SIZE } from '../audit-log.constants';

export class ListAuditLogDto {
  /**
   * Exact match. The screen has no input for it since the actor search
   * replaced it; kept so hand-built and bookmarked URLs keep working.
   */
  @IsOptional()
  @IsString()
  userId?: string;

  /**
   * Free-text search over the actor's first name, last name, or email, or the
   * literal `system` for entries with no user. The Actor column has always
   * shown names while the filter only accepted an id, so an operator could
   * read a name but not search for it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  actor?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  action?: string;

  /** ISO-8601 lower bound (inclusive). */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** ISO-8601 upper bound (inclusive). */
  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AUDIT_LOG_MAX_PAGE_SIZE)
  pageSize?: number;
}
