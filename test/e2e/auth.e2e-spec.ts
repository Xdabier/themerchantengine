import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { api, sessionCookie, createTestPrisma, recentActionUrl, tokenOf, ADMIN } from './helpers';
import { TEST_REDIS_HOST, TEST_REDIS_PORT } from './env';

/**
 * BA2.5 — backend auth e2e against the dockerised stack.
 *
 * Out-of-process: hits the webpack-bundled API on :53001 (started by
 * e2e-global-setup) over HTTP. Covers the Better Auth surface the migration
 * ships — sign-up → sign-in → session cookie → authed request → sign-out,
 * plus email verification, password reset, magic link, TOTP 2FA enrolment,
 * and the sign-in rate limit. Real Postgres + Redis; no mocks, no fixtures.
 */

const SUFFIX = '@e2e-auth.test';

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — confirms 2FA enrolment. */
function totp(base32Secret: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of base32Secret.replace(/=+$/, '').toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx >= 0) bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const hmac = crypto.createHmac('sha1', Buffer.from(bytes)).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    1_000_000;
  return code.toString().padStart(6, '0');
}

describe('Better Auth — backend (e2e)', () => {
  let prisma: PrismaClient;
  let redis: Redis;

  beforeAll(async () => {
    prisma = createTestPrisma();
    redis = new Redis({
      host: TEST_REDIS_HOST,
      port: TEST_REDIS_PORT,
      maxRetriesPerRequest: null,
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: SUFFIX } } });
    await prisma.notificationLog.deleteMany({ where: { recipient: { endsWith: SUFFIX } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: SUFFIX } } });
    await prisma.notificationLog.deleteMany({ where: { recipient: { endsWith: SUFFIX } } });
    await redis.quit();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clear Better Auth's Redis rate-limit budget so each test starts fresh —
    // otherwise the shared 127.0.0.1 origin trips the 5-per-window sign-in cap.
    const keys = await redis.keys('ba:ratelimit:*');
    if (keys.length) await redis.del(...keys);
  });

  // ── sign-up + email verification ─────────────────────────────────────────────

  describe('sign-up + email verification', () => {
    const email = `signup${SUFFIX}`;
    const password = 'StrongPass1!';

    it('POST /v1/auth/sign-up/email creates the user and sends a verification email', async () => {
      const res = await api()
        .post('/v1/auth/sign-up/email')
        .send({ email, password, name: 'Sign Up', firstName: 'Sign', lastName: 'Up' });
      expect(res.status).toBeLessThan(400);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();
      expect(user?.emailVerified).toBe(false);
      // A `credential` Account is created by Better Auth's own sign-up.
      const account = await prisma.account.findFirst({
        where: { userId: user!.id, providerId: 'credential' },
      });
      expect(account).not.toBeNull();
      await recentActionUrl(prisma, 'auth.email-verification', email);
    });

    it('sign-in is blocked until the email is verified', async () => {
      const res = await api().post('/v1/auth/sign-in/email').send({ email, password });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('GET /v1/auth/verify-email marks the account verified', async () => {
      const token = tokenOf(await recentActionUrl(prisma, 'auth.email-verification', email));
      await api().get(`/v1/auth/verify-email?token=${token}`);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user?.emailVerified).toBe(true);
    });

    it('sign-in succeeds after verification and sets a session cookie', async () => {
      const res = await api().post('/v1/auth/sign-in/email').send({ email, password }).expect(200);
      expect(sessionCookie(res)).toContain('session');
    });
  });

  // ── session + authed request + sign-out (seeded, pre-verified user) ──────────

  describe('session + authed request + sign-out', () => {
    it('sign-in with seeded credentials sets a HttpOnly session cookie', async () => {
      const res = await api()
        .post('/v1/auth/sign-in/email')
        .send({ email: ADMIN.email, password: ADMIN.password })
        .expect(200);
      const setCookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
      expect(setCookie).toContain('session');
      expect(setCookie.toLowerCase()).toContain('httponly');
    });

    it('the session cookie authorises a follow-up request to a guarded route', async () => {
      const signIn = await api()
        .post('/v1/auth/sign-in/email')
        .send({ email: ADMIN.email, password: ADMIN.password })
        .expect(200);

      const res = await api().get('/v1/users/me').set('Cookie', sessionCookie(signIn)).expect(200);
      expect(res.body.data.email).toBe(ADMIN.email);
    });

    it('a guarded route without a session returns 401 AUTH_UNAUTHENTICATED', async () => {
      const res = await api().get('/v1/users/me');
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('AUTH_UNAUTHENTICATED');
    });

    it('sign-out deletes the server-side session row', async () => {
      const signIn = await api()
        .post('/v1/auth/sign-in/email')
        .send({ email: ADMIN.email, password: ADMIN.password })
        .expect(200);
      const cookie = sessionCookie(signIn);
      const token: string = signIn.body?.token ?? signIn.body?.data?.token;
      expect(token).toBeTruthy();
      expect(await prisma.session.findUnique({ where: { token } })).not.toBeNull();

      await api().post('/v1/auth/sign-out').set('Cookie', cookie).expect(200);

      // The server-side session row is gone — the session is revoked
      // independent of the signed cookie-cache window (constitution §3.3
      // caps that at 5 minutes; a replayed cache cookie is by design still
      // honoured until it lapses).
      expect(await prisma.session.findUnique({ where: { token } })).toBeNull();
    });

    it('sign-in with a wrong password is rejected', async () => {
      const res = await api()
        .post('/v1/auth/sign-in/email')
        .send({ email: ADMIN.email, password: 'WrongPassword9!' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  // ── password reset ───────────────────────────────────────────────────────────

  describe('password reset', () => {
    const email = `reset${SUFFIX}`;
    const oldPassword = 'OldPass123!';
    const newPassword = 'NewPass456!';

    beforeAll(async () => {
      await api().post('/v1/auth/sign-up/email').send({
        email,
        password: oldPassword,
        name: 'Reset Me',
        firstName: 'Reset',
        lastName: 'Me',
      });
      // Grandfather verification so the post-reset sign-in is not gated on it.
      await prisma.user.update({ where: { email }, data: { emailVerified: true } });
    });

    it('request-password-reset sends a reset email', async () => {
      const res = await api()
        .post('/v1/auth/request-password-reset')
        .send({ email, redirectTo: '/reset' });
      expect(res.status).toBeLessThan(400);
      await recentActionUrl(prisma, 'auth.password-reset', email);
    });

    it('reset-password with the emailed token changes the password', async () => {
      const token = tokenOf(await recentActionUrl(prisma, 'auth.password-reset', email));
      const res = await api().post('/v1/auth/reset-password').send({ token, newPassword });
      expect(res.status).toBeLessThan(400);

      await api().post('/v1/auth/sign-in/email').send({ email, password: newPassword }).expect(200);

      const stale = await api()
        .post('/v1/auth/sign-in/email')
        .send({ email, password: oldPassword });
      expect(stale.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ── magic link ───────────────────────────────────────────────────────────────

  describe('magic link', () => {
    const email = `magic${SUFFIX}`;

    beforeAll(async () => {
      await api().post('/v1/auth/sign-up/email').send({
        email,
        password: 'MagicPass1!',
        name: 'Magic Link',
        firstName: 'Magic',
        lastName: 'Link',
      });
      await prisma.user.update({ where: { email }, data: { emailVerified: true } });
    });

    it('sign-in/magic-link sends a magic-link email', async () => {
      const res = await api().post('/v1/auth/sign-in/magic-link').send({ email });
      expect(res.status).toBeLessThan(400);
      await recentActionUrl(prisma, 'auth.magic-link', email);
    });

    it('verifying the magic link establishes a session', async () => {
      const token = tokenOf(await recentActionUrl(prisma, 'auth.magic-link', email));
      const res = await api().get(`/v1/auth/magic-link/verify?token=${token}`);
      expect([200, 302]).toContain(res.status);
      expect(sessionCookie(res)).toContain('session');
    });
  });

  // ── TOTP 2FA enrolment ───────────────────────────────────────────────────────

  describe('two-factor (TOTP)', () => {
    const email = `twofa${SUFFIX}`;
    const password = 'TwoFaPass1!';
    let cookie: string;
    let totpSecret = '';

    beforeAll(async () => {
      await api()
        .post('/v1/auth/sign-up/email')
        .send({ email, password, name: 'Two Fa', firstName: 'Two', lastName: 'Fa' });
      await prisma.user.update({ where: { email }, data: { emailVerified: true } });
      const signIn = await api()
        .post('/v1/auth/sign-in/email')
        .send({ email, password })
        .expect(200);
      cookie = sessionCookie(signIn);
    });

    it('enabling 2FA returns a TOTP URI and creates a TwoFactor row', async () => {
      const res = await api()
        .post('/v1/auth/two-factor/enable')
        .set('Cookie', cookie)
        .send({ password });
      expect(res.status).toBeLessThan(400);
      const uri: string = res.body?.totpURI ?? res.body?.data?.totpURI ?? '';
      expect(uri).toContain('otpauth://');
      // The shared secret comes from the enrolment URI — TwoFactor.secret is
      // stored encrypted at rest, so it cannot drive a TOTP computation.
      totpSecret = new URL(uri).searchParams.get('secret') ?? '';
      expect(totpSecret.length).toBeGreaterThan(0);

      const user = await prisma.user.findUnique({ where: { email } });
      const factors = await prisma.twoFactor.findMany({ where: { userId: user!.id } });
      expect(factors.length).toBeGreaterThanOrEqual(1);
    });

    it('verify-totp accepts a freshly computed code', async () => {
      const res = await api()
        .post('/v1/auth/two-factor/verify-totp')
        .set('Cookie', cookie)
        .send({ code: totp(totpSecret) });
      expect(res.status).toBeLessThan(400);
    });
  });

  // ── rate limiting ────────────────────────────────────────────────────────────

  describe('rate limiting', () => {
    // The test API runs with NODE_ENV=test, which raises the sign-in ceiling to
    // 200 / 15 min so parallel e2e workers seeding under the shared `127.0.0.1`
    // origin do not 429 (`apps/api/src/auth/rate-limits.ts`). The Jest worker
    // running this spec does NOT inherit that NODE_ENV in the same way the API
    // child process does, so importing the constant resolves to the prod tier
    // (max 5) — and the loop completes 15 attempts without triggering 429.
    // Pin the expected ceiling explicitly here. If `rate-limits.ts` changes its
    // test-env max, update this constant in lock-step.
    const SIGN_IN_MAX_TEST_ENV = 200;

    it('rapid sign-in attempts are eventually rejected with 429', async () => {
      let sawRateLimit = false;
      // Loop max + 10 — buffer above the configured ceiling so a single
      // request lost to network/Redis jitter still trips the limiter.
      const cap = SIGN_IN_MAX_TEST_ENV + 10;
      for (let i = 0; i < cap; i++) {
        const res = await api()
          .post('/v1/auth/sign-in/email')
          .send({ email: `ratelimit${SUFFIX}`, password: 'whatever' });
        if (res.status === 429) {
          sawRateLimit = true;
          break;
        }
      }
      expect(sawRateLimit).toBe(true);
    }, 120_000); // generously to accommodate Redis + Postgres lookups on each attempt. // 210 sequential HTTP calls in test env — bump Jest's default 5 s timeout
  });
});
