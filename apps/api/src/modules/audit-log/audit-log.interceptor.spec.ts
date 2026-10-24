import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { of, lastValueFrom } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { AuditLogService } from './audit-log.service';

// ── Mocks ─────────────────────────────────────────────────────────────────────

function makeContext(
  method: string,
  path: string,
  params: Record<string, string | undefined> = {},
  body: Record<string, unknown> = {},
  userId = 'user-1',
): ExecutionContext {
  const req = {
    method,
    path,
    params,
    body,
    ip: '127.0.0.1',
    headers: { 'user-agent': 'Jest/1.0' },
    user: { id: userId },
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function makeHandler(response: unknown = { id: 'new-id' }): CallHandler {
  return { handle: () => of(response) };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('AuditLogInterceptor', () => {
  let interceptor: AuditLogInterceptor;
  let auditLogService: { log: jest.Mock };
  let prisma: { product: { findUnique: jest.Mock } };

  beforeEach(async () => {
    auditLogService = { log: jest.fn().mockResolvedValue(undefined) };
    prisma = { product: { findUnique: jest.fn().mockResolvedValue({ id: 'x', name: 'Old' }) } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogInterceptor,
        { provide: AuditLogService, useValue: auditLogService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    interceptor = module.get<AuditLogInterceptor>(AuditLogInterceptor);
  });

  // ── shouldAudit ────────────────────────────────────────────────────────────

  it('skips GET requests', async () => {
    const ctx = makeContext('GET', '/v1/admin/products');
    const stream = await interceptor.intercept(ctx, makeHandler());
    await lastValueFrom(stream);
    expect(auditLogService.log).not.toHaveBeenCalled();
  });

  it('skips non-admin routes', async () => {
    const ctx = makeContext('POST', '/v1/storefront/carts');
    const stream = await interceptor.intercept(ctx, makeHandler());
    await lastValueFrom(stream);
    expect(auditLogService.log).not.toHaveBeenCalled();
  });

  // ── parseRoute — prefix-resilience (the R6.13 interceptor change) ──────────

  it('parses /v1/admin/products/:id PATCH with express params.id', async () => {
    const ctx = makeContext('PATCH', '/v1/admin/products/prod-backpack', { id: 'prod-backpack' });
    const stream = await interceptor.intercept(ctx, makeHandler({ id: 'prod-backpack' }));
    await lastValueFrom(stream);
    expect(auditLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'product.update',
        entityType: 'product',
        entityId: 'prod-backpack',
      }),
    );
  });

  it('parses /api/v1/admin/products/:id PATCH under API_GLOBAL_PREFIX=api', async () => {
    const ctx = makeContext('PATCH', '/api/v1/admin/products/prod-backpack', {
      id: 'prod-backpack',
    });
    const stream = await interceptor.intercept(ctx, makeHandler({ id: 'prod-backpack' }));
    await lastValueFrom(stream);
    expect(auditLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'product.update',
        entityType: 'product',
        entityId: 'prod-backpack',
      }),
    );
  });

  it('parses POST /v1/admin/products (create, no entityId)', async () => {
    const ctx = makeContext('POST', '/v1/admin/products');
    const stream = await interceptor.intercept(ctx, makeHandler({ id: 'new-prod' }));
    await lastValueFrom(stream);
    expect(auditLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'product.create',
        entityType: 'product',
        entityId: null,
      }),
    );
  });

  it('parses DELETE /api/v1/admin/products/:id with prefix', async () => {
    const ctx = makeContext('DELETE', '/api/v1/admin/products/prod-1', { id: 'prod-1' });
    const stream = await interceptor.intercept(ctx, makeHandler(null));
    await lastValueFrom(stream);
    expect(auditLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'product.delete',
        entityType: 'product',
        entityId: 'prod-1',
      }),
    );
    // DELETE never captures after-state.
    const payload = auditLogService.log.mock.calls[0][0] as {
      changes: { after: unknown };
    };
    expect(payload.changes.after).toBeNull();
  });

  it('falls back to path-segment id when params.id is absent and segment looks like a UUID', async () => {
    const uuid = '11111111-2222-3333-4444-555555555555';
    const ctx = makeContext('PATCH', `/api/v1/admin/orders/${uuid}/cancel`);
    const stream = await interceptor.intercept(ctx, makeHandler({ id: uuid }));
    await lastValueFrom(stream);
    expect(auditLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'order.update',
        entityType: 'order',
        entityId: uuid,
      }),
    );
  });

  it('captures before-state for PATCH on a mapped model', async () => {
    const ctx = makeContext('PATCH', '/api/v1/admin/products/prod-1', { id: 'prod-1' });
    const stream = await interceptor.intercept(ctx, makeHandler({ id: 'prod-1', name: 'New' }));
    await lastValueFrom(stream);
    expect(prisma.product.findUnique).toHaveBeenCalledWith({ where: { id: 'prod-1' } });
    const payload = auditLogService.log.mock.calls[0][0] as {
      changes: { before: unknown };
    };
    expect(payload.changes.before).toEqual({ id: 'x', name: 'Old' });
  });
});
