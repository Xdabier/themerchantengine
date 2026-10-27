import { listReturnsResponseSchema } from '@admin-services/returns/returns.schemas';
import { listReviewsResponseSchema } from '@admin-services/reviews/reviews.schemas';
import { test, expect } from '../fixtures/auth';
import { expectSchema } from '../helpers/zod-response';

test.describe('returns service contract', () => {
  test('GET /v1/admin/returns returns paginated returns', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/returns', {
      params: { pageSize: 5 },
    });
    await expectSchema(response, listReturnsResponseSchema, { status: 200 });
  });

  test('GET /v1/admin/returns filters by status', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/returns', {
      params: { status: 'REFUND_PROCESSED' },
    });
    const parsed = await expectSchema(response, listReturnsResponseSchema, {
      status: 200,
    });
    for (const row of parsed.data) expect(row.status).toBe('REFUND_PROCESSED');
  });
});

test.describe('reviews service contract', () => {
  test('GET /v1/admin/reviews returns paginated reviews', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/reviews', {
      params: { pageSize: 5 },
    });
    await expectSchema(response, listReviewsResponseSchema, { status: 200 });
  });

  test('GET /v1/admin/reviews filters by status', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/reviews', {
      params: { status: 'PUBLISHED' },
    });
    const parsed = await expectSchema(response, listReviewsResponseSchema, {
      status: 200,
    });
    for (const row of parsed.data) expect(row.status).toBe('PUBLISHED');
  });
});
