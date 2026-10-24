import { z } from 'zod';
import { listNotificationsResponseSchema, unreadCountSchema } from '@admin-types';
import { listWebhooksResponseSchema } from '@admin-services/webhooks/webhooks.schemas';
import { listAuditLogResponseSchema } from '@admin-services/audit-log/audit-log.schemas';
import {
  listSynonymsResponseSchema,
  listMerchandisingResponseSchema,
} from '@admin-services/search/search.schemas';
import { settingsResponseSchema } from '@admin-services/settings/settings.schemas';
import { test, expect } from '../fixtures/auth';
import { expectSchema } from '../helpers/zod-response';
import { dataShape } from '../helpers/shape';

test.describe('notifications service contract', () => {
  test('GET /v1/admin/notifications returns paginated notifications', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/notifications', {
      params: { pageSize: 5 },
    });
    await expectSchema(response, listNotificationsResponseSchema, { status: 200 });
  });

  test('GET /v1/admin/notifications/unread-count', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/notifications/unread-count');
    await expectSchema(response, dataShape(unreadCountSchema), { status: 200 });
  });
});

test.describe('webhooks service contract', () => {
  test('GET /v1/admin/webhooks returns paginated webhooks', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/webhooks', {
      params: { pageSize: 5 },
    });
    await expectSchema(response, listWebhooksResponseSchema, { status: 200 });
  });

  test('support role cannot create webhook', async ({ supportRequest }) => {
    const response = await supportRequest.post('/v1/admin/webhooks', {
      data: { url: 'https://example.com/hook', events: ['order.created'] },
    });
    expect(response.status()).toBe(403);
  });
});

test.describe('audit-log service contract', () => {
  test('GET /v1/admin/audit-log returns paginated log', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/audit-log', {
      params: { pageSize: 5 },
    });
    await expectSchema(response, listAuditLogResponseSchema, { status: 200 });
  });
});

test.describe('analytics service contract', () => {
  test('GET /v1/admin/analytics/dashboard returns KPIs', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/analytics/dashboard');
    await expectSchema(response, dataShape(z.unknown()), { status: 200 });
  });

  test('GET /v1/admin/analytics/revenue returns aggregate totals', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/analytics/revenue');
    await expectSchema(response, dataShape(z.unknown()), { status: 200 });
  });

  test('GET /v1/admin/analytics/timeseries returns bucketed orders', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/analytics/timeseries', {
      params: { metric: 'orders', granularity: 'day' },
    });
    const parsed = await expectSchema(
      response,
      dataShape(
        z.object({
          metric: z.enum(['orders', 'revenue', 'sessions']),
          granularity: z.enum(['hour', 'day', 'week']),
          from: z.string().datetime(),
          to: z.string().datetime(),
          buckets: z.array(
            z.object({ bucket: z.string().datetime(), value: z.number().nonnegative() }),
          ),
        }),
      ),
      { status: 200 },
    );
    expect(parsed.data.metric).toBe('orders');
    expect(parsed.data.buckets.length).toBeGreaterThan(0);
  });

  test('GET /v1/admin/analytics/timeseries rejects an unknown metric', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/analytics/timeseries', {
      params: { metric: 'pageviews' },
    });
    expect(response.status()).toBe(400);
  });
});

test.describe('search service contract', () => {
  test('GET /v1/admin/search/synonyms returns paginated synonyms', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/search/synonyms', {
      params: { pageSize: 5 },
    });
    await expectSchema(response, listSynonymsResponseSchema, { status: 200 });
  });

  test('GET /v1/admin/search/merchandising returns paginated rules', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/search/merchandising', {
      params: { pageSize: 5 },
    });
    await expectSchema(response, listMerchandisingResponseSchema, { status: 200 });
  });
});

test.describe('geo service contract', () => {
  test('GET /v1/admin/geo/ai-readiness returns a score', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/geo/ai-readiness');
    await expectSchema(response, dataShape(z.unknown()), { status: 200 });
  });
});

test.describe('settings service contract', () => {
  test('GET /v1/admin/settings returns config', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/settings');
    await expectSchema(response, settingsResponseSchema, { status: 200 });
  });

  test('GET /v1/admin/settings/locales returns locale config', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/settings/locales');
    await expectSchema(response, dataShape(z.unknown()), { status: 200 });
  });

  test('support role cannot update settings', async ({ supportRequest }) => {
    const response = await supportRequest.patch('/v1/admin/settings', {
      data: { group: 'general', key: 'storeName', value: 'Hacked' },
    });
    expect(response.status()).toBe(403);
  });
});

test.describe('assets service contract', () => {
  test('support role cannot upload assets', async ({ supportRequest }) => {
    const response = await supportRequest.post('/v1/admin/assets/upload', {
      multipart: { file: { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('x') } },
    });
    expect(response.status()).toBe(403);
  });
});
