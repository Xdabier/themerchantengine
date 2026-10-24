import { z } from 'zod';
import { redirectSchema } from '@admin-services/seo/seo.schemas';
import { synonymGroupSchema, merchandisingRuleSchema } from '@admin-services/search/search.schemas';
import {
  createWebhookRequestSchema,
  webhookWithSecretSchema,
} from '@admin-services/webhooks/webhooks.schemas';
import { apiErrorEnvelopeSchema } from '@admin-types';
import { test, expect } from '../fixtures/auth';
import { expectSchema } from '../helpers/zod-response';
import { dataShape } from '../helpers/shape';

/**
 * Mutation happy-paths. Each describe block owns its cleanup so suites stay
 * independent and re-runnable without a DB reset.
 */
test.describe('seo redirect CRUD', () => {
  const fromPath = '/e2e-test-redirect-' + Math.random().toString(36).slice(2, 8);
  let createdId: string | null = null;

  test('POST /v1/admin/seo/redirects creates a redirect', async ({ adminRequest }) => {
    const response = await adminRequest.post('/v1/admin/seo/redirects', {
      data: { fromPath, toPath: '/', type: 'MOVED_PERMANENTLY' },
    });
    const parsed = await expectSchema(response, dataShape(redirectSchema));
    expect(parsed.data.fromPath).toBe(fromPath);
    createdId = parsed.data.id;
  });

  test('DELETE /v1/admin/seo/redirects/:id cleans up', async ({ adminRequest }) => {
    test.skip(!createdId, 'prior create step must have set createdId');
    const response = await adminRequest.delete(`/v1/admin/seo/redirects/${createdId}`);
    expect([200, 204]).toContain(response.status());
  });
});

test.describe('search synonym CRUD', () => {
  let createdId: string | null = null;

  test('POST /v1/admin/search/synonyms creates a synonym group', async ({ adminRequest }) => {
    const response = await adminRequest.post('/v1/admin/search/synonyms', {
      data: { terms: ['e2e-term-a', 'e2e-term-b'] },
    });
    const parsed = await expectSchema(response, dataShape(synonymGroupSchema));
    createdId = parsed.data.id;
    expect(parsed.data.terms).toEqual(expect.arrayContaining(['e2e-term-a', 'e2e-term-b']));
  });

  test('DELETE /v1/admin/search/synonyms/:id cleans up', async ({ adminRequest }) => {
    test.skip(!createdId, 'prior create step must have set createdId');
    const response = await adminRequest.delete(`/v1/admin/search/synonyms/${createdId}`);
    expect([200, 204]).toContain(response.status());
  });

  test('synonyms reject fewer than 2 terms', async ({ adminRequest }) => {
    const response = await adminRequest.post('/v1/admin/search/synonyms', {
      data: { terms: ['only-one'] },
    });
    expect(response.status()).toBe(400);
    await expectSchema(response, apiErrorEnvelopeSchema, { status: 400 });
  });
});

test.describe('merchandising rule CRUD', () => {
  let createdId: string | null = null;

  test('POST /v1/admin/search/merchandising creates a rule', async ({ adminRequest }) => {
    // BOOST rules need a productId. Grab the first seeded product from the list.
    const list = await adminRequest.get('/v1/admin/products', { params: { pageSize: 1 } });
    const productId = (await list.json()).data[0].id;

    const response = await adminRequest.post('/v1/admin/search/merchandising', {
      data: { type: 'BOOST', productId, priority: 5 },
    });
    const parsed = await expectSchema(response, dataShape(merchandisingRuleSchema));
    createdId = parsed.data.id;
  });

  test('DELETE /v1/admin/search/merchandising/:id cleans up', async ({ adminRequest }) => {
    test.skip(!createdId, 'prior create step must have set createdId');
    const response = await adminRequest.delete(`/v1/admin/search/merchandising/${createdId}`);
    expect([200, 204]).toContain(response.status());
  });
});

test.describe('webhook CRUD', () => {
  let createdId: string | null = null;

  test('createWebhookRequestSchema accepts a valid HTTPS hook', () => {
    const parsed = createWebhookRequestSchema.safeParse({
      url: 'https://example.com/hook',
      events: ['order.created'],
    });
    expect(parsed.success).toBe(true);
  });

  test('POST /v1/admin/webhooks creates a webhook with a secret', async ({ adminRequest }) => {
    const response = await adminRequest.post('/v1/admin/webhooks', {
      data: {
        url: 'https://example.test/e2e-hook-' + Date.now(),
        events: ['order.created', 'order.cancelled'],
      },
    });
    const parsed = await expectSchema(response, dataShape(webhookWithSecretSchema));
    expect(parsed.data.secret.length).toBeGreaterThan(16);
    createdId = parsed.data.id;
  });

  test('PATCH /v1/admin/webhooks/:id updates events', async ({ adminRequest }) => {
    test.skip(!createdId, 'prior create step must have set createdId');
    const response = await adminRequest.patch(`/v1/admin/webhooks/${createdId}`, {
      data: { events: ['order.created'] },
    });
    await expectSchema(response, dataShape(z.unknown()));
  });

  test('DELETE /v1/admin/webhooks/:id cleans up', async ({ adminRequest }) => {
    test.skip(!createdId, 'prior create step must have set createdId');
    const response = await adminRequest.delete(`/v1/admin/webhooks/${createdId}`);
    expect([200, 204]).toContain(response.status());
  });

  test('webhooks reject non-https URLs', async ({ adminRequest }) => {
    const response = await adminRequest.post('/v1/admin/webhooks', {
      data: { url: 'http://example.com/hook', events: ['order.created'] },
    });
    expect(response.status()).toBe(400);
    await expectSchema(response, apiErrorEnvelopeSchema, { status: 400 });
  });
});
