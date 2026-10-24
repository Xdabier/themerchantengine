import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Middleware that sets security-related HTTP response headers on every request.
 *
 * Headers set:
 * - Content-Security-Policy  – tight allowlist; frame-ancestors 'none' prevents clickjacking
 * - Strict-Transport-Security – forces HTTPS for 1 year, including subdomains
 * - X-Content-Type-Options   – prevents MIME-type sniffing
 * - X-Frame-Options          – belt-and-suspenders clickjacking protection (CSP covers modern browsers)
 * - Referrer-Policy          – limits referrer leakage to same-origin on cross-origin requests
 */

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.s3.amazonaws.com",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP_DIRECTIVES,
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(header, value);
    }
    next();
  }
}
