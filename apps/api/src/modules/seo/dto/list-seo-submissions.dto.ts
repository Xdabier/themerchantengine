import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  SEO_SUBMISSION_ENGINES,
  SEO_SUBMISSION_TARGET_TYPES,
  SEO_SUBMISSION_TRIGGERS,
  SEO_SUBMISSIONS_DEFAULT_PAGE_SIZE,
  SEO_SUBMISSIONS_MAX_PAGE_SIZE,
  VALID_SUBMISSION_SORT_FIELDS,
} from '../seo.constants';

/**
 * Admin filter DTO for the SeoSubmission audit history (DR-17). class-validator
 * allowlist (§3.5); `whitelist: true` strips anything not declared here. Sort is
 * a fixed single-column allowlist — never interpolated from request input.
 */
export class ListSeoSubmissionsAdminDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SEO_SUBMISSIONS_MAX_PAGE_SIZE)
  pageSize?: number = SEO_SUBMISSIONS_DEFAULT_PAGE_SIZE;

  @IsOptional()
  @IsIn(VALID_SUBMISSION_SORT_FIELDS)
  sortBy?: (typeof VALID_SUBMISSION_SORT_FIELDS)[number];

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @IsIn(SEO_SUBMISSION_ENGINES)
  engine?: (typeof SEO_SUBMISSION_ENGINES)[number];

  @IsOptional()
  @IsIn(SEO_SUBMISSION_TRIGGERS)
  trigger?: (typeof SEO_SUBMISSION_TRIGGERS)[number];

  @IsOptional()
  @IsIn(SEO_SUBMISSION_TARGET_TYPES)
  targetType?: (typeof SEO_SUBMISSION_TARGET_TYPES)[number];

  /** Filter by fail-open outcome. */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  accepted?: boolean;

  /** Inclusive lower bound on createdAt (ISO 8601). Malformed → 400, never a 500. */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Inclusive upper bound on createdAt (ISO 8601). Malformed → 400, never a 500. */
  @IsOptional()
  @IsISO8601()
  to?: string;
}
