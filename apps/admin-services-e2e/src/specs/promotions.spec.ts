import {
  giftCardSchema,
  listGiftCardsResponseSchema,
} from '@admin-services/gift-cards/gift-cards.schemas';
import {
  listPromotionsResponseSchema,
  promotionSchema,
} from '@admin-services/promotions/promotions.schemas';
import { apiErrorEnvelopeSchema } from '@admin-types';
import { test, expect } from '../fixtures/auth';
import { expectSchema } from '../helpers/zod-response';
import { dataShape } from '../helpers/shape';

test.describe('promotions service contract', () => {
  test('GET /v1/admin/promotions returns paginated promotions', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/promotions', {
      params: { pageSize: 5 },
    });
    const parsed = await expectSchema(response, listPromotionsResponseSchema, {
      status: 200,
    });
    expect(parsed.data.length).toBeGreaterThan(0);
  });

  test('GET /v1/admin/promotions/:id returns a single promotion', async ({ adminRequest }) => {
    const list = await adminRequest.get('/v1/admin/promotions', { params: { pageSize: 1 } });
    const body = await list.json();
    if (!body.data.length) test.skip(true, 'no seeded promotions');
    const firstId = body.data[0].id;

    const response = await adminRequest.get(`/v1/admin/promotions/${firstId}`);
    await expectSchema(response, dataShape(promotionSchema), { status: 200 });
  });

  test('GET /v1/admin/promotions/:id 404s for unknown ids', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/promotions/does-not-exist');
    expect(response.status()).toBe(404);
  });

  test('support role cannot create promotions', async ({ supportRequest }) => {
    const response = await supportRequest.post('/v1/admin/promotions', {
      data: { name: { default: 'X' }, type: 'PERCENTAGE', applicationMethod: 'COUPON' },
    });
    expect(response.status()).toBe(403);
    await expectSchema(response, apiErrorEnvelopeSchema, { status: 403 });
  });
});

test.describe('gift-cards service contract', () => {
  test('GET /v1/admin/gift-cards returns paginated gift cards', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/gift-cards', {
      params: { pageSize: 5 },
    });
    await expectSchema(response, listGiftCardsResponseSchema, { status: 200 });
  });

  test('GET /v1/admin/gift-cards/:id returns a single card', async ({ adminRequest }) => {
    const list = await adminRequest.get('/v1/admin/gift-cards', { params: { pageSize: 1 } });
    const body = await list.json();
    if (!body.data.length) test.skip(true, 'no seeded gift cards');
    const firstId = body.data[0].id;

    const response = await adminRequest.get(`/v1/admin/gift-cards/${firstId}`);
    await expectSchema(response, dataShape(giftCardSchema), { status: 200 });
  });

  test('POST /v1/admin/gift-cards/:id/adjust credits then debits', async ({ adminRequest }) => {
    const list = await adminRequest.get('/v1/admin/gift-cards', {
      params: { pageSize: 10, isActive: true },
    });
    const body = await list.json();
    const card = body.data.find((c: { isActive: boolean }) => c.isActive);
    if (!card) test.skip(true, 'no active seeded gift cards');

    const credit = await adminRequest.post(`/v1/admin/gift-cards/${card.id}/adjust`, {
      data: { amount: 5, reason: 'e2e credit test' },
    });
    expect(credit.status()).toBe(201);

    const debit = await adminRequest.post(`/v1/admin/gift-cards/${card.id}/adjust`, {
      data: { amount: -5, reason: 'e2e debit test' },
    });
    expect(debit.status()).toBe(201);
  });

  test('POST /v1/admin/gift-cards/:id/adjust rejects zero delta', async ({ adminRequest }) => {
    const list = await adminRequest.get('/v1/admin/gift-cards', { params: { pageSize: 1 } });
    const body = await list.json();
    if (!body.data.length) test.skip(true, 'no seeded gift cards');
    const firstId = body.data[0].id;

    const response = await adminRequest.post(`/v1/admin/gift-cards/${firstId}/adjust`, {
      data: { amount: 0, reason: 'nothing' },
    });
    expect(response.status()).toBe(400);
  });

  test('POST /v1/admin/gift-cards/:id/resend queues for cards with recipients', async ({
    adminRequest,
  }) => {
    const list = await adminRequest.get('/v1/admin/gift-cards', { params: { pageSize: 10 } });
    const body = await list.json();
    const card = body.data.find(
      (c: { recipientEmail?: string | null; isActive: boolean }) => c.isActive && c.recipientEmail,
    );
    if (!card) test.skip(true, 'no active seeded gift card with a recipient email');

    const response = await adminRequest.post(`/v1/admin/gift-cards/${card.id}/resend`);
    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.data?.status ?? json.status).toBe('queued');
  });
});
