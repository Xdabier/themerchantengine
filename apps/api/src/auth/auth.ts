/**
 * Better Auth instance — owns authentication + sessions for merchants-engine.
 *
 * Mounted in `main.ts` as a raw Node handler (`toNodeHandler`) at
 * `AUTH_BASE_PATH`; consumed by `SessionAuthGuard` via `auth.api.getSession`.
 * It is a plain module-level singleton, not a Nest provider — it must exist
 * before the Nest router is built.
 *
 * Authorization (the `module:action` RBAC) is unchanged and lives elsewhere;
 * see `agent_docs/auth-rbac.md` and DR-24.
 */
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { twoFactor, magicLink, customSession, captcha } from 'better-auth/plugins';
import { isProduction } from '@common/env';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import Redis from 'ioredis';
import bcrypt from 'bcrypt';
import { createExtendedPrismaClient } from '../prisma/prisma.service';
import { getAuthMailer } from './auth-mailer';
import { RATE_LIMITS } from './rate-limits';
import { HONEYPOT_HEADER, SIGNUP_PATH, isHoneypotTripped } from './signup-hardening';

/** bcrypt cost factor — preserved from the retired custom stack so every
 *  pre-migration password hash stays valid (constitution §3.3, Phase 0 B5). */
const BCRYPT_COST = 12;

/** Optional API global prefix — `API_GLOBAL_PREFIX=api` in dev / e2e, where the
 *  admin reaches the backend through a same-origin `/api/*` proxy. */
const globalPrefix = process.env.API_GLOBAL_PREFIX
  ? `/${process.env.API_GLOBAL_PREFIX.replace(/^\/+|\/+$/g, '')}`
  : '';

/**
 * Base path the Better Auth handler is mounted at. Honours `API_GLOBAL_PREFIX`
 * so the admin's `/api/*` proxy and the storefront's direct `/v1/auth/*` path
 * both resolve. `main.ts` mounts `toNodeHandler(auth)` at `${AUTH_BASE_PATH}/*`
 * and `basePath` below keeps Better Auth's own routing in agreement.
 */
export const AUTH_BASE_PATH = `${globalPrefix}/v1/auth`;

/** Front-end origins allowed to call the auth routes (CSRF origin allowlist). */
const trustedOrigins = (process.env.CORS_ORIGIN ?? process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Production fail-loud per constitution §3.7. Mirrors the boot check in
// `apps/api/src/main.ts` for the same env var: an empty `trustedOrigins`
// makes Better Auth silently reject every state-changing auth callback. The
// BA5 security audit (C-2) flagged this fail-mode as easy to overlook because
// the user-visible symptom is "admin can't sign in", not "config error".
if (isProduction() && trustedOrigins.length === 0) {
  throw new Error(
    'CORS_ORIGIN (or CORS_ORIGINS) is empty in NODE_ENV=production. ' +
      'Better Auth requires at least one trusted origin to issue or accept ' +
      'sessions. Set the env var before booting. See .env.production.example.',
  );
}

/**
 * Soft-delete-extended Prisma client for the Better Auth adapter — the SAME
 * `$extends` query extension the app uses, so a soft-deleted (`deletedAt`)
 * user is filtered out of Better Auth's own user lookups and cannot sign in
 * (spec §4.D6). Deactivation (`isActive: false`) is enforced separately by
 * `SessionAuthGuard`.
 */
const prisma = createExtendedPrismaClient();

/** Redis client backing the Better Auth rate-limiter. Lazy-connects so merely
 *  importing this module (e.g. in a unit test) opens no socket. */
const redis = new Redis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 56379),
  password: process.env.REDIS_PASSWORD || undefined,
  lazyConnect: true,
  maxRetriesPerRequest: null,
  ...(process.env.REDIS_TLS === 'true' ? { tls: {} } : {}),
});

export const auth = betterAuth({
  appName: 'Merchants Engine',
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: AUTH_BASE_PATH,
  secret: process.env.BETTER_AUTH_SECRET,

  // Prisma adapter — given the soft-delete-extended client (see above).
  database: prismaAdapter(prisma, { provider: 'postgresql' }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    // New registrations must verify their email before they can sign in;
    // pre-migration users are grandfathered by the BA2 migration backfilling
    // `emailVerified: true` (clarification Q2).
    //
    // The storefront e2e suite sets `AUTH_SKIP_EMAIL_VERIFICATION=1` on its
    // test-API spawn so a freshly-registered customer can be authenticated
    // without an inbox round-trip. The backend e2e does NOT set the flag, so
    // `auth.e2e-spec.ts` keeps exercising the real require-verification path.
    requireEmailVerification: process.env.AUTH_SKIP_EMAIL_VERIFICATION !== '1',
    // Custom hasher — wraps bcrypt cost 12 so existing hashes stay valid.
    password: {
      hash: (password) => bcrypt.hash(password, BCRYPT_COST),
      verify: ({ hash, password }) => bcrypt.compare(password, hash),
    },
    sendResetPassword: async ({ user, url }) => {
      await getAuthMailer().sendPasswordReset(user.email, url);
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24, // 24 h
    sendVerificationEmail: async ({ user, url }) => {
      await getAuthMailer().sendVerificationEmail(user.email, url);
    },
    // NE5: once a customer proves their address, welcome them. Fire-and-forget —
    // a mail failure must never break the verification flow.
    afterEmailVerification: async (user: { email: string; name?: string }) => {
      await getAuthMailer().sendWelcome?.(user.email, user.name);
    },
  },

  session: {
    // 7-day session, sliding by 1 day — matches the prior refresh-token window
    // so customer-facing behaviour is unchanged (clarification Q1).
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    // The signed session-data cookie is trusted for at most 5 minutes without
    // a DB read, so a server-side revocation propagates quickly
    // (constitution §3.3 / §3.15-C).
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },

  // Map Better Auth's `user` model onto the existing `User` table.
  user: {
    fields: {
      // Better Auth's `image` ↔ the existing `avatarUrl` column.
      image: 'avatarUrl',
    },
    // `firstName` / `lastName` are existing NOT-NULL columns — declared so the
    // sign-up call carries them (clarification Q4). They are not auto-created;
    // the migration leaves the columns as they are.
    additionalFields: {
      firstName: { type: 'string', required: true, input: true },
      lastName: { type: 'string', required: true, input: true },
    },
    // ── Change-email confirmation ────────────────────────────────────────────
    // Better Auth fires this callback when the user requests a new email; we
    // send the "confirm your new email" link to the *new* address so the
    // change cannot complete without proving ownership of it (consistent with
    // the OWASP recommendation + spec §8.2). Available on Better Auth >=1.5.
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async (data: {
        user: { email: string };
        newEmail: string;
        url: string;
      }) => {
        await getAuthMailer().sendChangeEmailVerification?.(
          data.newEmail,
          data.url,
          data.user.email,
        );
        // NE5 security fix: alert the OLD address that a change was requested
        // (OWASP). The change is not applied until the new address is confirmed.
        await getAuthMailer().sendEmailChangeAlert?.(data.user.email, data.newEmail);
      },
    },
    // ── Account-deletion confirmation ────────────────────────────────────────
    // Better Auth's deleteUser flow requires a verified-by-email confirmation
    // before the destructive op runs — the callback below is what surfaces
    // that link. We do NOT auto-sign-in afterwards; the deletion endpoint
    // expires the session itself per Better Auth defaults.
    deleteUser: {
      enabled: true,
      sendDeleteAccountVerification: async (data: { user: { email: string }; url: string }) => {
        await getAuthMailer().sendDeleteAccountVerification?.(data.user.email, data.url);
      },
    },
  },

  databaseHooks: {
    user: {
      create: {
        // Better Auth's core `user` requires `name`; derive it from
        // firstName + lastName so a sign-up client only sends those two.
        before: async (user) => {
          const u = user as typeof user & {
            firstName?: string;
            lastName?: string;
            name?: string;
          };
          if (!u.name && (u.firstName || u.lastName)) {
            return {
              data: {
                ...u,
                name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(),
              },
            };
          }
          return;
        },
      },
      update: {
        // 2FA enable/disable confirmation emails (NE8). The twoFactor plugin is
        // the only writer of `twoFactorEnabled` (internalAdapter.updateUser at
        // enrol-completion / disable), so the flag's presence in the update
        // payload is a precise toggle signal. The partial `data` (before) carries
        // the new flag but not the email; the full `user` (after, queued
        // post-commit) carries the email but not the diff — so we stash the intent
        // on the `context` in `before` and act on it in `after`. NOTE: that
        // context is REQUEST-scoped (shared across every DB op in the request),
        // not per-updateUser-call, so the `after` hook CLEARS the stash after
        // reading it — that way a second `user` update later in the same request
        // (today none exists after a 2FA toggle, but a future flow/plugin might)
        // cannot re-fire a spurious notice. Best-effort: a null context (no
        // request scope) simply skips the notice.
        before: async (data, context) => {
          const flag = (data as { twoFactorEnabled?: unknown }).twoFactorEnabled;
          if (typeof flag === 'boolean' && context) {
            (context as unknown as Record<string, unknown>).__twoFactorToggle = flag;
          }
          return;
        },
        after: async (user, context) => {
          if (!context) return;
          const ctx = context as unknown as Record<string, unknown>;
          const stash = ctx.__twoFactorToggle;
          delete ctx.__twoFactorToggle; // consume once — never re-fire in this request
          if (typeof stash !== 'boolean') return;
          const email = (user as { email?: string }).email;
          if (!email) return;
          if (stash) await getAuthMailer().sendTwoFactorEnabled?.(email);
          else await getAuthMailer().sendTwoFactorDisabled?.(email);
        },
      },
    },
  },

  // Sign-up bot-abuse honeypot (2026-06-23) — defense-in-depth alongside the
  // Turnstile captcha plugin below. Rejects a sign-up whose hidden form field
  // (sent as the `x-hp-field` header) came back filled. Real browsers leave it
  // blank; form-scraping bots fill it. Header-based so it never collides with
  // Better Auth's sign-up body schema. See `signup-hardening.ts`.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== SIGNUP_PATH) return;
      if (isHoneypotTripped(ctx.path, ctx.headers?.get(HONEYPOT_HEADER))) {
        throw new APIError('BAD_REQUEST', { message: 'Registration could not be completed.' });
      }
      return;
    }),
  },

  trustedOrigins,

  advanced: {
    // Stable cookie prefix → `better-auth.session_token` etc. (a prefix derived
    // from `appName` would contain a space — invalid in a cookie name).
    cookiePrefix: 'better-auth',
    useSecureCookies: isProduction(),
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
    },
    // Cross-subdomain session cookie — production only, where the admin /
    // storefront / API share a registrable domain. `AUTH_COOKIE_DOMAIN` is the
    // leading-dot root domain (e.g. `.shop.example`).
    ...(process.env.AUTH_COOKIE_DOMAIN
      ? {
          crossSubDomainCookies: {
            enabled: true,
            domain: process.env.AUTH_COOKIE_DOMAIN,
          },
        }
      : {}),
  },

  // Better Auth's built-in rate limiter, backed by Redis so limits hold across
  // API instances. Replaces the retired custom `@RateLimit.Auth()` decorator.
  //
  // In the e2e test environment (NODE_ENV=test) the limits are raised to allow
  // the Playwright suite to seed test data via the auth endpoints without
  // hitting the production-tuned thresholds. The test Redis (port 56380) is
  // wiped by global-setup before every suite run, so test runs don't accumulate
  // across sessions — the higher limit is purely to accommodate parallel workers
  // seeding customers during a single run (constitution §3.8). The rate-limit
  // e2e in `test/e2e/auth.e2e-spec.ts` imports `RATE_LIMITS` below so it
  // exercises the actual configured ceiling without drift.
  rateLimit: {
    enabled: true,
    customStorage: {
      get: async (key) => {
        const raw = await redis.get(`ba:ratelimit:${key}`);
        return raw ? JSON.parse(raw) : undefined;
      },
      set: async (key, value) => {
        await redis.set(`ba:ratelimit:${key}`, JSON.stringify(value), 'EX', 60 * 60);
      },
    },
    customRules: RATE_LIMITS,
  },

  plugins: [
    // Cloudflare Turnstile on sign-up (2026-06-23) — the primary bot defense.
    // GATED on TURNSTILE_SECRET so dev / e2e (which never set it) stay open; the
    // plugin verifies the `x-captcha-response` header the storefront register
    // form sends. Scoped to `/sign-up/email` (the confirmed abuse vector) to
    // avoid adding friction to sign-in. Activate on prod by setting both
    // TURNSTILE_SECRET (here) and the storefront VITE_TURNSTILE_SITE_KEY.
    ...(process.env.TURNSTILE_SECRET
      ? [
          captcha({
            provider: 'cloudflare-turnstile',
            secretKey: process.env.TURNSTILE_SECRET,
            endpoints: [SIGNUP_PATH],
          }),
        ]
      : []),
    twoFactor({
      issuer: 'Merchants Engine',
      otpOptions: {
        // Email-OTP second factor (NE8, O11). Better Auth generates + stores the
        // OTP and invokes this to deliver it; we route through the AuthMailer seam
        // so it crosses the same MailService.enqueue pipeline (audit row, locale
        // resolution, suppression) as every other auth email. The OTP renders into
        // the body but is redacted from the audit row (safeMetadata, §3.7).
        sendOTP: async ({ user, otp }) => {
          await getAuthMailer().sendTwoFactorOtp?.(user.email, otp);
        },
      },
    }),
    magicLink({
      expiresIn: 60 * 5, // 5 min
      // Bot-abuse hardening (2026-06-25). Better Auth's /sign-in/magic-link
      // handler calls sendMagicLink UNCONDITIONALLY for any caller-supplied
      // address, and `disableSignUp` only blocks account CREATION at verify-time
      // (after the mail would already have gone out). Left alone that makes the
      // endpoint an open address-harvesting / mail-relay vector — the door bots
      // pivot to once /sign-up/email is captcha-gated. Two layers close it:
      //  1. Gate the SEND here on an existing, active account, so a magic link
      //     only ever reaches a real user (recipient no longer attacker-chosen).
      //     Enumeration-safe: Better Auth returns the same { status: true }
      //     regardless of whether we actually send.
      //  2. disableSignUp — defense-in-depth so a stray token can never mint an
      //     account on verify. Plus a 5/15min rate-limit rule (rate-limits.ts).
      disableSignUp: true,
      sendMagicLink: async ({ email, url }) => {
        const account = await prisma.user.findFirst({
          where: { email: email.trim().toLowerCase(), isActive: true },
          select: { id: true },
        });
        if (!account) return; // unknown / inactive address — send nothing
        await getAuthMailer().sendMagicLink(email, url);
      },
    }),
    // ── customSession — RBAC on the session payload ──────────────────────────
    // Constitution §3.15-C requires the admin + storefront to bootstrap with a
    // SINGLE `getSession()` call resolving ONE fully-formed session object — no
    // second `/me` round-trip to reconcile. The `module:action` RBAC the admin
    // gates routes on (`permissionGuard`, the nav) is not part of Better Auth's
    // native session, so it is folded in here: every `getSession()` carries the
    // user's `Role` / `RolePermission`s, `role`, `status`, and `locale`. The
    // `module:action` system itself is unchanged (DR-24) — this only surfaces
    // the existing RBAC data on the session response. `SessionAuthGuard` keeps
    // its own fresh per-request DB read; this augmentation is for the clients.
    customSession(async ({ user, session }) => {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        include: { customRole: { include: { permissions: true } } },
      });
      if (!dbUser) {
        // Soft-deleted users resolve to null through the extended client. The
        // session row may still exist briefly (e.g. inside the cookieCache
        // window) but SessionAuthGuard's per-request fresh user read rejects
        // the next request with 401 (constitution §3.3 / spec §4.D6). Return
        // user: null so a client that reads getSession() during the brief
        // window degrades to "signed out" instead of rendering a half-formed
        // user object (BA5 audit L-1).
        return { user: null, session };
      }
      const rolePermissions = dbUser.customRole?.permissions.map((p) => p.permission) ?? [];
      return {
        session,
        user: {
          ...user,
          role: dbUser.role,
          // Permissions are carried ONLY under `roles[].permissions` — the
          // admin's `effectivePermissions(roles)` helper is the single source
          // of truth (constitution §3.14). A flat `permissions` field at the
          // top level would invite drift for any new consumer (BA5 audit H-3).
          roles: dbUser.customRole
            ? [
                {
                  id: dbUser.customRole.id,
                  name: dbUser.customRole.name,
                  permissions: rolePermissions,
                },
              ]
            : [],
          status: dbUser.isActive ? 'active' : 'inactive',
          locale: dbUser.locale,
          twoFactorEnabled: dbUser.twoFactorEnabled ?? false,
        },
      };
    }),
  ],

  // ── Social login — config-ready, disabled (clarification Q5) ───────────────
  // Google + Apple are the relevant providers for a regional retail
  // storefront. Enabling either is a follow-up feature: supply the client
  // OAuth credentials and uncomment the block below. No social-login UI ships
  // in the better-auth-migration feature itself.
  //
  // socialProviders: {
  //   google: {
  //     clientId: process.env.GOOGLE_CLIENT_ID as string,
  //     clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
  //   },
  //   apple: {
  //     clientId: process.env.APPLE_CLIENT_ID as string,
  //     clientSecret: process.env.APPLE_CLIENT_SECRET as string,
  //   },
  // },
});

/** The Better Auth instance type — for typing `main.ts` + `SessionAuthGuard`. */
export type Auth = typeof auth;
