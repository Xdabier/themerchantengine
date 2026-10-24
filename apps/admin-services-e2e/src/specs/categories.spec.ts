import { z } from 'zod';
import { apiErrorEnvelopeSchema } from '@admin-types';
import { categorySchema } from '@admin-services/categories/categories.schemas';
import { test, expect } from '../fixtures/auth';
import { expectSchema } from '../helpers/zod-response';
import { dataShape } from '../helpers/shape';

test.describe('categories service contract', () => {
  test('GET /v1/admin/categories returns the full tree', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/categories');
    const parsed = await expectSchema(response, dataShape(z.array(categorySchema)), {
      status: 200,
    });
    expect(parsed.data.length).toBeGreaterThan(0);
  });

  test('categories tree exposes nested children', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/categories');
    const parsed = await expectSchema(response, dataShape(z.array(categorySchema)), {
      status: 200,
    });
    const parent = parsed.data.find((c) => (c.children?.length ?? 0) > 0);
    expect(parent, 'expected at least one category with children').toBeDefined();
  });

  test('support role cannot create categories', async ({ supportRequest }) => {
    const response = await supportRequest.post('/v1/admin/categories', {
      data: { name: { default: 'X', en: 'X' }, slug: 'x' },
    });
    expect(response.status()).toBe(403);
    await expectSchema(response, apiErrorEnvelopeSchema, { status: 403 });
  });
});
