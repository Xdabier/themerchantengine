import { test as base, expect, request as requestApi } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { loginResponseSchema } from '@admin-services/auth/auth.schemas';
import { apiResponseSchema } from '@admin-types';
import { expectSchema } from '../helpers/zod-response';

/**
 * Login wraps the payload in the shared `{data}` envelope — the Angular
 * service strips it via `envelope()` before Zod-parsing. We do the same here
 * by validating against `apiResponseSchema(loginResponseSchema)` and pulling
 * `.data` out.
 */
const loginEnvelopeSchema = apiResponseSchema(loginResponseSchema);
import { TEST_USERS, type TestUserKey } from './test-users';

/**
 * Per-role authenticated request contexts.
 *
 * Scope: **worker** — each role logs in exactly once per worker. Tests that
 * re-login per test tripped the backend's 5/15min login throttler. Playwright
 * workers correspond to parallel browsers; with `workers=1` in config we end
 * up with ≤ N_ROLES logins across the whole suite, which stays well under
 * the limit even on cold DBs where every spec exercises the auth endpoint.
 *
 * If a spec needs an additional short-lived context for a specific user
 * (e.g. a newly-created staff account) it can call `loginAs()`, which is
 * test-scoped and disposes on teardown.
 */
export interface AdminAuthFixtures {
  adminRequest: APIRequestContext;
  managerRequest: APIRequestContext;
  supportRequest: APIRequestContext;
  anonRequest: APIRequestContext;
  loginAs: (key: TestUserKey) => Promise<APIRequestContext>;
}

function resolveBaseURL(): string {
  return process.env['API_BASE_URL'] || 'http://localhost:53000';
}

async function loginAndBuildContext(key: TestUserKey, baseURL: string): Promise<APIRequestContext> {
  const user = TEST_USERS[key];
  const bootstrap = await requestApi.newContext({ baseURL });
  const loginRes = await bootstrap.post('/v1/auth/login', {
    data: { email: user.email, password: user.password },
  });
  const parsed = await expectSchema(loginRes, loginEnvelopeSchema, { status: 200 });
  await bootstrap.dispose();

  return requestApi.newContext({
    baseURL,
    extraHTTPHeaders: {
      Authorization: `Bearer ${parsed.data.accessToken}`,
      'X-Resolve-Locale': 'false',
      // CSRF Layer 2 — backend rejects /auth/refresh without this header.
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
}

export const test = base
  .extend<Record<string, never>, Omit<AdminAuthFixtures, 'loginAs'>>({
    adminRequest: [
      async ({}, use) => {
        const ctx = await loginAndBuildContext('admin', resolveBaseURL());
        await use(ctx);
        await ctx.dispose();
      },
      { scope: 'worker' },
    ],
    managerRequest: [
      async ({}, use) => {
        const ctx = await loginAndBuildContext('manager', resolveBaseURL());
        await use(ctx);
        await ctx.dispose();
      },
      { scope: 'worker' },
    ],
    supportRequest: [
      async ({}, use) => {
        const ctx = await loginAndBuildContext('support', resolveBaseURL());
        await use(ctx);
        await ctx.dispose();
      },
      { scope: 'worker' },
    ],
    anonRequest: [
      async ({}, use) => {
        const ctx = await requestApi.newContext({
          baseURL: resolveBaseURL(),
          extraHTTPHeaders: {
            // Refresh endpoint requires this CSRF layer even pre-auth — the
            // anon context sits in front of /v1/auth/* calls.
            'X-Requested-With': 'XMLHttpRequest',
          },
        });
        await use(ctx);
        await ctx.dispose();
      },
      { scope: 'worker' },
    ],
  })
  .extend<{ loginAs: AdminAuthFixtures['loginAs'] }>({
    loginAs: async ({}, use) => {
      const contexts: APIRequestContext[] = [];
      const fn = async (key: TestUserKey) => {
        const ctx = await loginAndBuildContext(key, resolveBaseURL());
        contexts.push(ctx);
        return ctx;
      };
      await use(fn);
      await Promise.all(contexts.map((c) => c.dispose()));
    },
  });

export { expect };
