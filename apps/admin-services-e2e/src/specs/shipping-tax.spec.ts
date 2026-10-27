import {
  listMethodsResponseSchema,
  listZonesResponseSchema as listShippingZonesResponseSchema,
} from '@admin-services/shipping/shipping.schemas';
import {
  listClassesResponseSchema,
  listZonesResponseSchema as listTaxZonesResponseSchema,
} from '@admin-services/tax/tax.schemas';
import { test, expect } from '../fixtures/auth';
import { expectSchema } from '../helpers/zod-response';

test.describe('shipping + tax service contracts', () => {
  test('GET /v1/admin/shipping/zones returns zones', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/shipping/zones');
    await expectSchema(response, listShippingZonesResponseSchema, { status: 200 });
  });

  test('GET /v1/admin/shipping/methods returns methods', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/shipping/methods');
    await expectSchema(response, listMethodsResponseSchema, { status: 200 });
  });

  test('GET /v1/admin/tax/zones returns zones', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/tax/zones');
    await expectSchema(response, listTaxZonesResponseSchema, { status: 200 });
  });

  test('GET /v1/admin/tax/classes returns classes', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/tax/classes');
    await expectSchema(response, listClassesResponseSchema, { status: 200 });
  });

  test('support role cannot create shipping zone', async ({ supportRequest }) => {
    const response = await supportRequest.post('/v1/admin/shipping/zones', {
      data: { name: 'X', countries: ['AE'] },
    });
    expect(response.status()).toBe(403);
  });
});
