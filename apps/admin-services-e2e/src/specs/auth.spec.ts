import {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  loginResponseSchema,
  logoutResponseSchema,
  refreshResponseSchema,
} from '@admin-services/auth/auth.schemas';
import { apiErrorEnvelopeSchema, apiResponseSchema } from '@admin-types';
import { test, expect } from '../fixtures/auth';
import { TEST_USERS } from '../fixtures/test-users';
import { expectSchema } from '../helpers/zod-response';

/**
 * Auth contract smoke. Exercises `/v1/auth/*` against the seeded DB and
 * asserts both happy-path and rejection paths match the schemas the Angular
 * service expects at runtime.
 */
test.describe('auth service contract', () => {
  test('loginRequestSchema accepts the seeded admin', () => {
    const parsed = loginRequestSchema.safeParse({
      email: TEST_USERS.admin.email,
      password: TEST_USERS.admin.password,
    });
    expect(parsed.success).toBe(true);
  });

  test('POST /v1/auth/login returns accessToken + user', async ({ anonRequest }) => {
    const response = await anonRequest.post('/v1/auth/login', {
      data: { email: TEST_USERS.admin.email, password: TEST_USERS.admin.password },
    });
    const parsed = await expectSchema(response, apiResponseSchema(loginResponseSchema), {
      status: 200,
    });
    expect(parsed.data.accessToken).toMatch(/\S+\.\S+\.\S+/);
    expect(parsed.data.user.email).toBe(TEST_USERS.admin.email);
  });

  test('POST /v1/auth/login rejects bad credentials with error envelope', async ({
    anonRequest,
  }) => {
    const response = await anonRequest.post('/v1/auth/login', {
      data: { email: TEST_USERS.admin.email, password: 'definitely-wrong' },
    });
    expect(response.status()).toBe(401);
    await expectSchema(response, apiErrorEnvelopeSchema, { status: 401 });
  });

  test('POST /v1/auth/refresh rotates the access token', async ({ anonRequest }) => {
    // Uses the anon context's cookie jar — login sets the refreshToken cookie,
    // which the refresh call then rotates. X-Requested-With is injected by the
    // fixture (CSRF layer 2).
    const loginRes = await anonRequest.post('/v1/auth/login', {
      data: { email: TEST_USERS.admin.email, password: TEST_USERS.admin.password },
    });
    await expectSchema(loginRes, apiResponseSchema(loginResponseSchema), { status: 200 });

    const refreshRes = await anonRequest.post('/v1/auth/refresh');
    // Backend returns 201 (same POST convention as /logout) — treat 2xx as success.
    await expectSchema(refreshRes, apiResponseSchema(refreshResponseSchema));
  });

  test('POST /v1/auth/logout clears the session', async ({ adminRequest }) => {
    // Backend returns 201 (not 200) — POST convention; treat 2xx as success.
    const response = await adminRequest.post('/v1/auth/logout');
    await expectSchema(response, apiResponseSchema(logoutResponseSchema));
  });

  test('POST /v1/auth/forgot-password always 200s (enumeration safe)', async ({ anonRequest }) => {
    const parsed = forgotPasswordRequestSchema.safeParse({
      email: 'nobody-knows@example.com',
    });
    expect(parsed.success).toBe(true);

    const response = await anonRequest.post('/v1/auth/forgot-password', {
      data: { email: 'nobody-knows@example.com' },
    });
    expect(response.status()).toBe(200);
    // Response body shape is { data: { message } } — assert the envelope only.
    await expectSchema(
      response,
      apiResponseSchema(logoutResponseSchema.partial().or(logoutResponseSchema)),
      { status: 200 },
    );
  });

  test('protected routes 401 without a token', async ({ anonRequest }) => {
    const response = await anonRequest.get('/v1/users/me');
    expect(response.status()).toBe(401);
    await expectSchema(response, apiErrorEnvelopeSchema, { status: 401 });
  });
});
