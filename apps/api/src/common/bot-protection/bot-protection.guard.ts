import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { redactUrl } from '@common/utils';
import { CAPTCHA_HEADER, HONEYPOT_HEADER, valueLooksFilled } from '../../auth/signup-hardening';
import { verifyTurnstileToken } from './turnstile.util';

/**
 * Reusable bot defense for `@Public()` NestJS endpoints that create rows or send
 * email to caller-supplied addresses (newsletter subscribe, contact form…).
 * Mirrors the sign-up hardening but at the NestJS layer (Better Auth's captcha
 * plugin only covers its own routes).
 *
 * Two layers, applied via `@BotProtected()`:
 *  1. Honeypot (always on) — a hidden field real users leave blank, carried in
 *     the `x-hp-field` header. Any non-empty value ⇒ reject. Header-based so it
 *     never collides with the route's body DTO / `whitelist` validation.
 *  2. Cloudflare Turnstile (gated on `TURNSTILE_SECRET`) — verifies the
 *     `x-captcha-response` header via siteverify. When the secret is unset
 *     (dev / e2e) this layer is skipped, so those environments stay open, matching
 *     the sign-up captcha plugin.
 *
 * Order matters: honeypot first (free, no network) catches naive bots before we
 * spend a siteverify round-trip.
 */
@Injectable()
export class BotProtectionGuard implements CanActivate {
  private readonly logger = new Logger(BotProtectionGuard.name);

  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      method?: string;
      url?: string;
      ip?: string;
      headers?: Record<string, string | string[] | undefined>;
    }>();

    const header = (name: string): string | undefined => {
      const v = req.headers?.[name];
      return Array.isArray(v) ? v[0] : v;
    };

    // 1. Honeypot — always on.
    if (valueLooksFilled(header(HONEYPOT_HEADER))) {
      this.logger.warn(`honeypot tripped on ${req.method ?? '?'} ${redactUrl(req.url ?? '?')}`);
      throw new BadRequestException({
        error: { code: 'BOT_DETECTED', message: 'Request could not be completed.' },
      });
    }

    // 2. Turnstile — gated on the secret so dev / e2e stay open.
    const secret = this.config.get<string>('TURNSTILE_SECRET');
    if (!secret) return true;

    const token = header(CAPTCHA_HEADER);
    if (!valueLooksFilled(token)) {
      throw new BadRequestException({
        error: { code: 'CAPTCHA_REQUIRED', message: 'Captcha verification is required.' },
      });
    }

    const ok = await verifyTurnstileToken(secret, token!.trim(), req.ip);
    if (!ok) {
      this.logger.warn(
        `captcha verification failed on ${req.method ?? '?'} ${redactUrl(req.url ?? '?')}`,
      );
      throw new BadRequestException({
        error: { code: 'CAPTCHA_FAILED', message: 'Captcha verification failed.' },
      });
    }

    return true;
  }
}
