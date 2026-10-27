import {
  customerSchema,
  customerSegmentSummarySchema,
  listCustomersResponseSchema,
  roleSchema,
} from '@admin-services/users/users.schemas';
import {
  adminUserSchema,
  apiErrorEnvelopeSchema,
  apiResponseSchema,
  paginationMetaSchema,
} from '@admin-types';
import { z } from 'zod';
import { test, expect } from '../fixtures/auth';
import { expectSchema } from '../helpers/zod-response';

/**
 * Users + RBAC contract smoke. Covers `/v1/users/me` (self-service) plus the
 * admin-only customer/staff/role listing endpoints. Also checks that
 * permission boundaries return the error envelope shape.
 */
test.describe('users service contract', () => {
  test('GET /v1/users/me returns the authenticated admin', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/users/me');
    const parsed = await expectSchema(response, apiResponseSchema(adminUserSchema), {
      status: 200,
    });
    expect(parsed.data.email).toBeTruthy();
  });

  test('GET /v1/admin/customers returns paginated customers', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/customers', {
      params: { page: 1, pageSize: 5 },
    });
    const parsed = await expectSchema(response, listCustomersResponseSchema, {
      status: 200,
    });
    expect(parsed.meta.page).toBe(1);
    expect(parsed.meta.pageSize).toBe(5);
    if (parsed.data.length > 0) {
      expect(customerSchema.safeParse(parsed.data[0]).success).toBe(true);
    }
  });

  test('GET /v1/admin/customers/segments returns segment counts', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/customers/segments');
    await expectSchema(response, apiResponseSchema(z.array(customerSegmentSummarySchema)), {
      status: 200,
    });
  });

  test('GET /v1/admin/staff returns paginated staff', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/staff');
    await expectSchema(
      response,
      z.object({
        data: z.array(adminUserSchema),
        meta: paginationMetaSchema,
      }),
      { status: 200 },
    );
  });

  test('GET /v1/admin/roles returns the seeded role set', async ({ adminRequest }) => {
    const response = await adminRequest.get('/v1/admin/roles');
    const parsed = await expectSchema(response, apiResponseSchema(z.array(roleSchema)), {
      status: 200,
    });
    const names = parsed.data.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['Super Admin', 'Admin']));
  });

  test('support role is forbidden from /v1/admin/staff', async ({ supportRequest }) => {
    const response = await supportRequest.get('/v1/admin/staff');
    expect(response.status()).toBe(403);
    await expectSchema(response, apiErrorEnvelopeSchema, { status: 403 });
  });
});
