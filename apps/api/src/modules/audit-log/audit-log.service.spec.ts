import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from './audit-log.service';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  auditLogEntry: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

function makeEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'entry-1',
    userId: 'user-1',
    action: 'product.update',
    entityType: 'product',
    entityId: 'prod-1',
    changes: { before: { name: 'Old' }, after: { name: 'New' } },
    ipAddress: '1.2.3.4',
    userAgent: 'Jest/1.0',
    createdAt: new Date('2026-01-01T10:00:00Z'),
    user: { id: 'user-1', email: 'admin@example.com', firstName: 'Admin', lastName: 'User' },
    ...overrides,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('AuditLogService', () => {
  let service: AuditLogService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditLogService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
  });

  // ── log() ─────────────────────────────────────────────────────────────────

  describe('log()', () => {
    it('creates an AuditLogEntry with all provided fields', async () => {
      mockPrisma.auditLogEntry.create.mockResolvedValue({});

      await service.log({
        userId: 'user-1',
        action: 'product.create',
        entityType: 'product',
        entityId: 'prod-1',
        changes: { before: null, after: { name: 'Widget' } },
        ipAddress: '10.0.0.1',
        userAgent: 'Chrome/120',
      });

      expect(mockPrisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          action: 'product.create',
          entityType: 'product',
          entityId: 'prod-1',
          changes: { before: null, after: { name: 'Widget' } },
          ipAddress: '10.0.0.1',
          userAgent: 'Chrome/120',
        },
      });
    });

    it('accepts null userId for system actions', async () => {
      mockPrisma.auditLogEntry.create.mockResolvedValue({});

      await service.log({
        userId: null,
        action: 'setting.update',
        entityType: 'setting',
        entityId: null,
        changes: { before: null, after: null },
        ipAddress: null,
        userAgent: null,
      });

      expect(mockPrisma.auditLogEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: null }) }),
      );
    });

    it('swallows Prisma errors without throwing', async () => {
      mockPrisma.auditLogEntry.create.mockRejectedValue(new Error('DB down'));

      await expect(
        service.log({
          userId: 'user-1',
          action: 'product.update',
          entityType: 'product',
          entityId: 'prod-1',
          changes: { before: {}, after: {} },
          ipAddress: null,
          userAgent: null,
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ── list() ────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns paginated results with default page/pageSize', async () => {
      const entries = [makeEntry(), makeEntry({ id: 'entry-2' })];
      mockPrisma.auditLogEntry.findMany.mockResolvedValue(entries);
      mockPrisma.auditLogEntry.count.mockResolvedValue(2);

      const result = await service.list({});

      expect(result.data).toHaveLength(2);
      expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 2 });
    });

    it('applies userId filter', async () => {
      mockPrisma.auditLogEntry.findMany.mockResolvedValue([]);
      mockPrisma.auditLogEntry.count.mockResolvedValue(0);

      await service.list({ userId: 'user-42' });

      expect(mockPrisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-42' }),
        }),
      );
    });

    it('applies entityType filter', async () => {
      mockPrisma.auditLogEntry.findMany.mockResolvedValue([]);
      mockPrisma.auditLogEntry.count.mockResolvedValue(0);

      await service.list({ entityType: 'order' });

      expect(mockPrisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ entityType: 'order' }),
        }),
      );
    });

    it('applies partial action filter', async () => {
      mockPrisma.auditLogEntry.findMany.mockResolvedValue([]);
      mockPrisma.auditLogEntry.count.mockResolvedValue(0);

      await service.list({ action: 'product' });

      expect(mockPrisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ action: { contains: 'product' } }),
        }),
      );
    });

    it('applies actor as a name/email search on the joined user', async () => {
      mockPrisma.auditLogEntry.findMany.mockResolvedValue([]);
      mockPrisma.auditLogEntry.count.mockResolvedValue(0);

      await service.list({ actor: 'Badii' });

      expect(mockPrisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: {
              OR: [
                { firstName: { contains: 'Badii', mode: 'insensitive' } },
                { lastName: { contains: 'Badii', mode: 'insensitive' } },
                { email: { contains: 'Badii', mode: 'insensitive' } },
              ],
            },
          }),
        }),
      );
    });

    it('matches both the null-user rows and anyone actually named System', async () => {
      mockPrisma.auditLogEntry.findMany.mockResolvedValue([]);
      mockPrisma.auditLogEntry.count.mockResolvedValue(0);

      await service.list({ actor: 'System' });

      const call = mockPrisma.auditLogEntry.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      // A staff member can set their own name to "System", so a filter that
      // resolved only to `userId: null` would hide their entries from the very
      // query used to review unattributed activity.
      expect(call.where['OR']).toEqual([
        { userId: null },
        {
          user: {
            OR: [
              { firstName: { contains: 'System', mode: 'insensitive' } },
              { lastName: { contains: 'System', mode: 'insensitive' } },
              { email: { contains: 'System', mode: 'insensitive' } },
            ],
          },
        },
      ]);
      expect(call.where).not.toHaveProperty('userId');
    });

    it('does not clobber an explicit userId when actor is "system"', async () => {
      mockPrisma.auditLogEntry.findMany.mockResolvedValue([]);
      mockPrisma.auditLogEntry.count.mockResolvedValue(0);

      await service.list({ userId: 'user-42', actor: 'system' });

      const call = mockPrisma.auditLogEntry.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      // The contradictory pair must return nothing, not silently answer a
      // different question than the one the investigator asked.
      expect(call.where['userId']).toBe('user-42');
      expect(call.where['OR']).toBeDefined();
    });

    it('trims the actor term and ignores a blank one', async () => {
      mockPrisma.auditLogEntry.findMany.mockResolvedValue([]);
      mockPrisma.auditLogEntry.count.mockResolvedValue(0);

      await service.list({ actor: '   ' });

      const call = mockPrisma.auditLogEntry.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(call.where['user']).toBeUndefined();
      expect(call.where).not.toHaveProperty('userId');
    });

    it('combines actor with entityType', async () => {
      mockPrisma.auditLogEntry.findMany.mockResolvedValue([]);
      mockPrisma.auditLogEntry.count.mockResolvedValue(0);

      await service.list({ actor: 'ada@example.com', entityType: 'gift_card' });

      const call = mockPrisma.auditLogEntry.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(call.where['entityType']).toBe('gift_card');
      expect(call.where['user']).toBeDefined();
    });

    it('keeps userId supported alongside actor for existing deep links', async () => {
      mockPrisma.auditLogEntry.findMany.mockResolvedValue([]);
      mockPrisma.auditLogEntry.count.mockResolvedValue(0);

      await service.list({ userId: 'user-42', actor: 'Ada' });

      const call = mockPrisma.auditLogEntry.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(call.where['userId']).toBe('user-42');
      expect(call.where['user']).toBeDefined();
    });

    it('applies from date filter', async () => {
      mockPrisma.auditLogEntry.findMany.mockResolvedValue([]);
      mockPrisma.auditLogEntry.count.mockResolvedValue(0);

      await service.list({ from: '2026-01-01T00:00:00Z' });

      const call = mockPrisma.auditLogEntry.findMany.mock.calls[0][0] as {
        where: { createdAt: { gte: Date } };
      };
      expect(call.where.createdAt.gte).toEqual(new Date('2026-01-01T00:00:00Z'));
    });

    it('applies to date filter', async () => {
      mockPrisma.auditLogEntry.findMany.mockResolvedValue([]);
      mockPrisma.auditLogEntry.count.mockResolvedValue(0);

      await service.list({ to: '2026-12-31T23:59:59Z' });

      const call = mockPrisma.auditLogEntry.findMany.mock.calls[0][0] as {
        where: { createdAt: { lte: Date } };
      };
      expect(call.where.createdAt.lte).toEqual(new Date('2026-12-31T23:59:59Z'));
    });

    it('applies both from and to filters together', async () => {
      mockPrisma.auditLogEntry.findMany.mockResolvedValue([]);
      mockPrisma.auditLogEntry.count.mockResolvedValue(0);

      await service.list({ from: '2026-01-01T00:00:00Z', to: '2026-06-30T23:59:59Z' });

      const call = mockPrisma.auditLogEntry.findMany.mock.calls[0][0] as {
        where: { createdAt: { gte: Date; lte: Date } };
      };
      expect(call.where.createdAt.gte).toEqual(new Date('2026-01-01T00:00:00Z'));
      expect(call.where.createdAt.lte).toEqual(new Date('2026-06-30T23:59:59Z'));
    });

    it('respects custom page and pageSize', async () => {
      mockPrisma.auditLogEntry.findMany.mockResolvedValue([]);
      mockPrisma.auditLogEntry.count.mockResolvedValue(50);

      const result = await service.list({ page: 3, pageSize: 10 });

      expect(mockPrisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(result.meta).toEqual({ page: 3, pageSize: 10, total: 50 });
    });

    it('orders results by createdAt descending', async () => {
      mockPrisma.auditLogEntry.findMany.mockResolvedValue([]);
      mockPrisma.auditLogEntry.count.mockResolvedValue(0);

      await service.list({});

      expect(mockPrisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });

    it('includes user relation', async () => {
      mockPrisma.auditLogEntry.findMany.mockResolvedValue([]);
      mockPrisma.auditLogEntry.count.mockResolvedValue(0);

      await service.list({});

      expect(mockPrisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            user: { select: { id: true, email: true, firstName: true, lastName: true } },
          },
        }),
      );
    });
  });

  // ── getByEntity() ─────────────────────────────────────────────────────────

  describe('getByEntity()', () => {
    it('filters by entityType and entityId', async () => {
      const entries = [makeEntry()];
      mockPrisma.auditLogEntry.findMany.mockResolvedValue(entries);
      mockPrisma.auditLogEntry.count.mockResolvedValue(1);

      const result = await service.getByEntity('product', 'prod-1', {});

      expect(mockPrisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { entityType: 'product', entityId: 'prod-1' },
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
    });

    it('returns empty when no entries exist for entity', async () => {
      mockPrisma.auditLogEntry.findMany.mockResolvedValue([]);
      mockPrisma.auditLogEntry.count.mockResolvedValue(0);

      const result = await service.getByEntity('order', 'nonexistent-id', {});

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });

    it('respects pagination parameters', async () => {
      mockPrisma.auditLogEntry.findMany.mockResolvedValue([]);
      mockPrisma.auditLogEntry.count.mockResolvedValue(30);

      const result = await service.getByEntity('product', 'prod-1', { page: 2, pageSize: 5 });

      expect(mockPrisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5, take: 5 }),
      );
      expect(result.meta).toEqual({ page: 2, pageSize: 5, total: 30 });
    });

    it('orders by createdAt descending', async () => {
      mockPrisma.auditLogEntry.findMany.mockResolvedValue([]);
      mockPrisma.auditLogEntry.count.mockResolvedValue(0);

      await service.getByEntity('product', 'prod-1', {});

      expect(mockPrisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });
  });
});
