import { test } from './_auth-fixture';
import { request } from '@playwright/test';
import { expectRoute } from './_helpers';

test('payment methods list renders', async ({ page }) => {
  await expectRoute(page, '/payment-methods', 'payment-methods-list-page');
});

test('payment method detail renders against a seeded method', async ({ page, baseURL }) => {
  // The seed ships with zero payment methods so `firstIdFromApi` would throw.
  // Seed one inline, open the detail route, tear down. Keeps the smoke spec
  // self-contained and the list total at 0 between runs.
  //
  // BA3 (DR-24): uses Better Auth cookie-based auth — retired `/api/v1/auth/login`
  // + `Authorization: Bearer` replaced by sign-in/email + Cookie header.
  const ctx = await request.newContext({ baseURL });
  const login = await ctx.post('/api/v1/auth/sign-in/email', {
    data: { email: 'superadmin@merchants.test', password: 'Admin123!' },
  });
  if (!login.ok()) {
    throw new Error(`[payments.spec] sign-in failed: ${login.status()} ${await login.text()}`);
  }
  const loginState = await ctx.storageState();
  const sessionCookies = loginState.cookies.filter((c) => c.name.startsWith('better-auth'));
  const cookieHeader = sessionCookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const code = `smoke_${Date.now()}`;
  const createRes = await ctx.post('/api/v1/admin/payment-methods', {
    headers: { Cookie: cookieHeader },
    data: { code, name: { default: 'Smoke' }, provider: 'manual' },
  });
  const { data: seeded } = (await createRes.json()) as { data: { id: string } };

  try {
    await expectRoute(page, `/payment-methods/${seeded.id}`, 'payment-method-detail-page');
  } finally {
    await ctx.delete(`/api/v1/admin/payment-methods/${seeded.id}`, {
      headers: { Cookie: cookieHeader },
    });
    await ctx.dispose();
  }
});

test('payment method new renders', async ({ page }) => {
  await expectRoute(page, '/payment-methods/new', 'payment-method-new-page');
});

test('checkout settings renders', async ({ page }) => {
  await expectRoute(page, '/checkout-settings', 'checkout-settings-page');
});
