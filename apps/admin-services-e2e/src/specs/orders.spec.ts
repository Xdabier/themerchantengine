import { z } from 'zod';
import { apiErrorEnvelopeSchema } from '@admin-types';
import { listOrdersResponseSchema, orderSchema } from '@admin-services/orders/orders.schemas';
import { test, expect } from '../fixtures/auth';
import { expectSchema } from '../helpers/zod-response';
import { dataShape } from '../helpers/shape';

test.describe('orders service contract', () => {
  test('GET /v1/admin/orders returns paginated orders', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/orders', {
      params: { pageSize: 5 },
    });
    const parsed = await expectSchema(response, listOrdersResponseSchema, {
      status: 200,
    });
    expect(parsed.meta.total).toBeGreaterThanOrEqual(0);
  });

  test('GET /v1/admin/orders filters by status', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/orders', {
      params: { status: 'CONFIRMED', pageSize: 10 },
    });
    const parsed = await expectSchema(response, listOrdersResponseSchema, {
      status: 200,
    });
    for (const row of parsed.data) expect(row.status).toBe('CONFIRMED');
  });

  test('GET /v1/admin/orders/:id returns a single order', async ({ adminRequest }) => {
    const list = await adminRequest.get('/v1/admin/orders', { params: { pageSize: 1 } });
    const listBody = await list.json();
    if (!listBody.data.length) test.skip(true, 'no seeded orders');
    const firstId = listBody.data[0].id;

    const response = await adminRequest.get(`/v1/admin/orders/${firstId}`);
    const parsed = await expectSchema(response, dataShape(orderSchema), { status: 200 });
    expect(parsed.data.id).toBe(firstId);
  });

  test('GET /v1/admin/orders/stats returns aggregate numbers', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/orders/stats');
    await expectSchema(response, dataShape(z.unknown()), { status: 200 });
  });

  test('GET /v1/admin/orders/:id 404s for unknown ids', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/orders/order-does-not-exist');
    expect(response.status()).toBe(404);
    await expectSchema(response, apiErrorEnvelopeSchema, { status: 404 });
  });
});
