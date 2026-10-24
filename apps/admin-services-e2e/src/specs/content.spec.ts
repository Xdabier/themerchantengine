import { z } from 'zod';
import { listPagesResponseSchema as listCmsPagesResponseSchema } from '@admin-services/cms/cms.schemas';
import { listRedirectsResponseSchema } from '@admin-services/seo/seo.schemas';
import { listPagesResponseSchema as listStorefrontPagesResponseSchema } from '@admin-services/storefront-config/storefront-config.schemas';
import { test, expect } from '../fixtures/auth';
import { expectSchema } from '../helpers/zod-response';
import { dataShape } from '../helpers/shape';

test.describe('cms service contract', () => {
  test('GET /v1/admin/pages returns paginated pages', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/pages', {
      params: { pageSize: 5 },
    });
    await expectSchema(response, listCmsPagesResponseSchema, { status: 200 });
  });

  test('support role cannot create a page', async ({ supportRequest }) => {
    const response = await supportRequest.post('/v1/admin/pages', {
      data: { slug: '/test', type: 'STANDARD', title: { default: 'X' }, content: { default: 'X' } },
    });
    expect(response.status()).toBe(403);
  });
});

test.describe('seo service contract', () => {
  test('GET /v1/admin/seo/redirects returns paginated redirects', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/seo/redirects', {
      params: { pageSize: 5 },
    });
    await expectSchema(response, listRedirectsResponseSchema, { status: 200 });
  });

  test('GET /v1/admin/seo/health returns a report', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/seo/health');
    await expectSchema(response, dataShape(z.unknown()), { status: 200 });
  });
});

test.describe('storefront-config service contract', () => {
  test('GET /v1/admin/storefront/pages returns page slugs', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/storefront/pages');
    await expectSchema(response, listStorefrontPagesResponseSchema, { status: 200 });
  });

  test('support role cannot reorder sections', async ({ supportRequest }) => {
    const response = await supportRequest.patch(
      '/v1/admin/storefront/pages/home/sections/reorder',
      { data: { orderedIds: ['00000000-0000-4000-8000-000000000000'] } },
    );
    expect(response.status()).toBe(403);
  });
});
