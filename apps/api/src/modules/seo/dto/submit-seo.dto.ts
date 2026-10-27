import {
  ArrayMaxSize,
  ArrayNotEmpty,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import {
  SEO_SUBMISSION_ENGINES,
  SEO_SUBMIT_MAX_PRODUCT_IDS,
  type SeoSubmissionEngine,
} from '../seo.constants';

/**
 * Admin-only body for `POST /v1/admin/seo/submit` (DR-17 D2). class-validator
 * allowlist (§3.5); `whitelist: true` strips anything not declared here.
 *
 * The target is exactly one of `url` | `productIds` | `sitemap`. Per-field
 * FORMAT is validated here; the "exactly one target" cardinality is enforced in
 * `SeoSubmitOrchestrator` (it must reject the all-absent case, which an
 * `@IsOptional` field-level rule would skip).
 *
 * Note: Product IDs in this system are CUIDs (`@default(cuid())`), not UUID v4.
 * The validator uses `@IsString({ each: true })` to accept any non-empty string
 * id — the orchestrator resolves them via `resolveActivePublicSlugs` which
 * simply queries `WHERE id IN (...)`, so type-safety is at the DB layer.
 */
export class SubmitSeoAdminDto {
  /** Single absolute storefront URL to push to IndexNow. */
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true, require_tld: false })
  url?: string;

  /** Product ids whose locale-prefixed URLs are pushed to IndexNow. */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(SEO_SUBMIT_MAX_PRODUCT_IDS)
  @IsString({ each: true })
  productIds?: string[];

  /** Resubmit the whole sitemap to the feed engines. Must be literal `true`. */
  @IsOptional()
  @IsBoolean()
  @Equals(true)
  sitemap?: boolean;

  /** Optional engine narrowing; defaults to every engine applicable to the target. */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(SEO_SUBMISSION_ENGINES, { each: true })
  engines?: SeoSubmissionEngine[];

  /** Preview only — resolve + count URLs without spending quota or recording rows. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
