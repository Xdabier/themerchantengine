import type { ConfigService } from '@nestjs/config';

/**
 * The public origins that appear inside outbound mail links.
 *
 * Seven call sites each carried their own client default before
 * D7, two in `dispatch/url.util.ts`, one each in `unsubscribe.controller.ts`,
 * `newsletter.controller.ts`, `campaign.service.ts`, `staff-digest.processor.ts`,
 * and two more reading `process.env` directly in `auth-mailer.provider.ts`.
 * A missed one does not fail; it sends a customer to another client's domain.
 *
 * Defaults are development conveniences. `validateMailEnv` refuses to boot in
 * production when any of them is left unset, for the same reason it guards the
 * sender identity: an unset host does not fail, it sends a customer to another
 * client's domain inside an email that authenticates as this one. That is the
 * failure `plan.md` section 7 records, one variable over from where it was
 * first found.
 */
const DEV_DEFAULTS = {
  storefront: 'https://storefront.example.test',
  admin: 'https://admin.example.test',
} as const;

/**
 * The env keys that carry the public origins, in the order the boot guard
 * reports them. `API_PUBLIC_BASE_URL` is here rather than beside its own helper
 * because it is the same class of value and the operator sets all three at once.
 */
export const MAIL_PUBLIC_HOST_KEYS = [
  'STOREFRONT_PUBLIC_BASE_URL',
  'ADMIN_PUBLIC_BASE_URL',
  'API_PUBLIC_BASE_URL',
] as const;

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Storefront public origin, trailing slash trimmed. */
export function storefrontBaseUrl(config?: ConfigService): string {
  const raw =
    config?.get<string>('STOREFRONT_PUBLIC_BASE_URL') ??
    process.env.STOREFRONT_PUBLIC_BASE_URL ??
    DEV_DEFAULTS.storefront;
  return trimTrailingSlash(raw);
}

/** Admin dashboard public origin, trailing slash trimmed. */
export function adminBaseUrl(config?: ConfigService): string {
  const raw =
    config?.get<string>('ADMIN_PUBLIC_BASE_URL') ??
    process.env.ADMIN_PUBLIC_BASE_URL ??
    DEV_DEFAULTS.admin;
  return trimTrailingSlash(raw);
}
