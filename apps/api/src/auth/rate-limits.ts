import { isTest } from '@common/env';

/**
 * Better Auth rate-limit ceilings per auth route.
 *
 * The test env is deliberately relaxed so parallel e2e workers seeding under
 * the shared `127.0.0.1` origin do not trip the production-tuned cap (200 vs
 * 5 sign-ins / 15 min). Exported as a standalone constant — importable by the
 * auth e2e (`test/e2e/auth.e2e-spec.ts`) without pulling in the Better Auth
 * runtime — so the test exercises the actual configured ceiling. The test was
 * previously hard-coded to 8 iterations and silently broke when the test-env
 * relaxation landed in BA3; this seam closes that drift.
 */
interface RateLimitRule {
  readonly window: number;
  readonly max: number;
}

/**
 * Typed as a record so the two branches can carry different key sets without
 * TypeScript widening the extra keys to `| undefined`, which Better Auth's
 * `customRules` index signature rejects.
 */
export const RATE_LIMITS: Record<string, RateLimitRule> = isTest()
  ? {
      // Every admin page load resolves the session once, and the Playwright
      // workers all share the `127.0.0.1` bucket, so Better Auth's default
      // (~100/60s) tripped mid-suite. A 429 there leaves the store empty and
      // the guard bounces the worker to /auth/login, which surfaced as dozens
      // of unrelated "page did not mount" failures.
      '/get-session': { window: 60, max: 100_000 },
      '/sign-in/email': { window: 900, max: 200 },
      '/sign-up/email': { window: 900, max: 200 },
      '/sign-in/magic-link': { window: 900, max: 200 },
      '/request-password-reset': { window: 900, max: 200 },
      '/send-verification-email': { window: 900, max: 200 },
      '/two-factor/verify-totp': { window: 900, max: 200 },
    }
  : {
      '/sign-in/email': { window: 900, max: 5 },
      '/sign-up/email': { window: 900, max: 5 },
      // Email-sending auth routes that were previously falling through to
      // Better Auth's generous default (~100/60s). Bot-abuse hardening
      // 2026-06-25: cap arbitrary-recipient mail (magic-link) and
      // resend-verification at the same 5/15min ceiling as reset.
      '/sign-in/magic-link': { window: 900, max: 5 },
      '/request-password-reset': { window: 900, max: 5 },
      '/send-verification-email': { window: 900, max: 5 },
      '/two-factor/verify-totp': { window: 900, max: 10 },
    };
