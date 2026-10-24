import { z } from 'zod';
import { apiErrorEnvelopeSchema } from '@admin-types';
import {
  listProductsResponseSchema,
  productSchema,
  productTypeSchema,
  attributeSchema,
} from '@admin-services/products/products.schemas';
import { test, expect } from '../fixtures/auth';
import { expectSchema } from '../helpers/zod-response';
import { dataShape } from '../helpers/shape';

/**
 * Products contract spec — tight schemas now that the backend serialises
 * Date → ISO string and Decimal → number (see commit fixing
 * TranslatableInterceptor isPlainObject guard).
 */
test.describe('products service contract', () => {
  test('GET /v1/admin/products returns paginated products', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/products', {
      params: { pageSize: 5 },
    });
    const parsed = await expectSchema(response, listProductsResponseSchema, {
      status: 200,
    });
    expect(parsed.meta.pageSize).toBe(5);
    expect(parsed.data.length).toBeGreaterThan(0);
  });

  test('GET /v1/admin/products supports sort + filter query params', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/products', {
      params: { sortBy: 'createdAt', sortOrder: 'desc', status: 'ACTIVE', pageSize: 3 },
    });
    const parsed = await expectSchema(response, listProductsResponseSchema, {
      status: 200,
    });
    for (const row of parsed.data) expect(row.status).toBe('ACTIVE');
  });

  test('GET /v1/admin/products/:id returns a single product', async ({ adminRequest }) => {
    const list = await adminRequest.get('/v1/admin/products', { params: { pageSize: 1 } });
    const listBody = await list.json();
    const firstId = listBody.data[0].id;

    const response = await adminRequest.get(`/v1/admin/products/${firstId}`);
    const parsed = await expectSchema(response, dataShape(productSchema), {
      status: 200,
    });
    expect(parsed.data.id).toBe(firstId);
  });

  test('GET /v1/admin/products/:id returns 404 for unknown ids', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/products/does-not-exist');
    expect(response.status()).toBe(404);
    await expectSchema(response, apiErrorEnvelopeSchema, { status: 404 });
  });

  test('GET /v1/admin/product-types returns seeded product types', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/product-types');
    const parsed = await expectSchema(response, dataShape(z.array(productTypeSchema)), {
      status: 200,
    });
    expect(parsed.data.length).toBeGreaterThan(0);
  });

  test('GET /v1/admin/attributes returns attribute catalog', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/attributes');
    await expectSchema(response, dataShape(z.array(attributeSchema)), { status: 200 });
  });

  test('support role cannot create products', async ({ supportRequest }) => {
    const response = await supportRequest.post('/v1/admin/products', {
      data: {
        name: { default: 'X', en: 'X' },
        slug: 'x',
        productTypeId: 'pt-general',
      },
    });
    expect(response.status()).toBe(403);
    await expectSchema(response, apiErrorEnvelopeSchema, { status: 403 });
  });
});
