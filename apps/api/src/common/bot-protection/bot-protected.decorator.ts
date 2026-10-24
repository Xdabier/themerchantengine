import { applyDecorators, UseGuards } from '@nestjs/common';

import { BotProtectionGuard } from './bot-protection.guard';

/**
 * Apply honeypot + (gated) Cloudflare Turnstile to a `@Public()` route. The
 * guard reads the `x-hp-field` / `x-captcha-response` headers — no body DTO
 * change required. The owning module must register `BotProtectionGuard` as a
 * provider so Nest can inject `ConfigService`.
 */
export function BotProtected(): MethodDecorator & ClassDecorator {
  return applyDecorators(UseGuards(BotProtectionGuard));
}
