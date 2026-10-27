/**
 * Sign-up bot-abuse hardening (2026-06-23).
 *
 * Prod verification surfaced a steady drip of bot-created accounts (gibberish
 * names, harvested real emails, all unverified) on `/sign-up/email` — each
 * firing a verification email to a real, unconsenting address, which threatens
 * the Resend sender reputation. Two layers defend the endpoint:
 *
 *  1. Cloudflare Turnstile (the official Better Auth `captcha` plugin) — the
 *     real defense; a tokenless direct-API sign-up is rejected. Wired in
 *     `auth.ts`, gated on `TURNSTILE_SECRET` so dev / e2e stay open.
 *  2. Honeypot (this file) — a hidden form field real users never fill, sent
 *     back as the `x-hp-field` header. Cheap defense-in-depth that catches
 *     form-scraping bots even before the Turnstile keys are configured. Sent as
 *     a header (not a body field) so it never collides with Better Auth's
 *     sign-up body schema.
 */

/** Header a sign-up request carries the honeypot value in. */
export const HONEYPOT_HEADER = 'x-hp-field';

/** Header a bot-protected request carries the Cloudflare Turnstile token in. */
export const CAPTCHA_HEADER = 'x-captcha-response';

/** The Better Auth (prefix-relative) path the protections apply to. */
export const SIGNUP_PATH = '/sign-up/email';

/**
 * True when a hidden honeypot field came back non-empty — real browsers leave
 * it blank, so any value is a bot. Path-agnostic so it can back both the Better
 * Auth sign-up hook and the NestJS `BotProtectionGuard` (newsletter, contact…).
 */
export function valueLooksFilled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * True when a request trips the honeypot — i.e. it targets sign-up AND the
 * hidden field came back non-empty. Real browsers leave the field blank.
 */
export function isHoneypotTripped(path: string, honeypot: string | null | undefined): boolean {
  return path === SIGNUP_PATH && valueLooksFilled(honeypot);
}
