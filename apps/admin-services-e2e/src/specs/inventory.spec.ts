import {
  listLocationsResponseSchema,
  listStockLevelsResponseSchema,
} from '@admin-services/inventory/inventory.schemas';
import { z } from 'zod';
import { test, expect } from '../fixtures/auth';
import { expectSchema } from '../helpers/zod-response';
import { dataShape } from '../helpers/shape';

test.describe('inventory service contract', () => {
  test('GET /v1/admin/inventory returns paginated stock rows', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/inventory', {
      params: { pageSize: 5 },
    });
    await expectSchema(response, listStockLevelsResponseSchema, { status: 200 });
  });

  test('GET /v1/admin/inventory/alerts returns low/out-of-stock list', async ({ adminRequest }) => {
    // Alerts endpoint returns `{data: StockLevel[]}` (no meta) — same row
    // schema but as a bare data array.
    const response = await adminRequest.get('/v1/admin/inventory/alerts');
    await expectSchema(response, dataShape(z.array(z.unknown())), { status: 200 });
  });

  test('GET /v1/admin/inventory/locations returns locations', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/inventory/locations');
    await expectSchema(response, listLocationsResponseSchema, { status: 200 });
  });

  test('support role cannot adjust stock', async ({ supportRequest }) => {
    const response = await supportRequest.post('/v1/admin/inventory/transfer', {
      data: { variantId: 'var-backpack', quantity: 1, from: 'loc-1', to: 'loc-2' },
    });
    expect(response.status()).toBe(403);
  });
});
