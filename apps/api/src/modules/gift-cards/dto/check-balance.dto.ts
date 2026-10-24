import { IsString, Matches } from 'class-validator';

/**
 * Storefront DTO — check gift card balance by code (public endpoint).
 * Rate limited to 10 req/min per IP (spec §8.1 API6).
 */
export class CheckBalanceDto {
  /**
   * Redemption code. Accept any non-whitespace sequence up to 32 chars.
   * Pattern is intentionally lenient — the service returns a generic error
   * on any invalid/not-found code to prevent enumeration (spec §8.1 API6).
   */
  @IsString()
  @Matches(/^\S{1,32}$/)
  code: string;
}
