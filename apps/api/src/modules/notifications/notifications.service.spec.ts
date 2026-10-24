import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  notification: {
    create: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
  },
};

function makeNotification(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'notif-1',
    userId: 'user-1',
    type: 'NEW_ORDER',
    title: { default: 'New Order', en: 'New Order', fr: 'Nouvelle commande' },
    body: { default: 'Order placed', en: 'Order placed', fr: 'Commande passée' },
    data: { orderId: 'ord-1' },
    isRead: false,
    readAt: null,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    ...overrides,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  // ── create() ───────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('creates a notification with all fields', async () => {
      mockPrisma.notification.create.mockResolvedValue(makeNotification());

      const result = await service.create(
        'user-1',
        'NEW_ORDER',
        { default: 'New Order', en: 'New Order', fr: 'Nouvelle commande' },
        { default: 'Order placed', en: 'Order placed', fr: 'Commande passée' },
        { orderId: 'ord-1' },
      );

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'NEW_ORDER',
          title: { default: 'New Order', en: 'New Order', fr: 'Nouvelle commande' },
          body: { default: 'Order placed', en: 'Order placed', fr: 'Commande passée' },
          data: { orderId: 'ord-1' },
        },
      });
      expect(result).toEqual(makeNotification());
    });

    it('handles missing body and data', async () => {
      mockPrisma.notification.create.mockResolvedValue(
        makeNotification({ body: null, data: null }),
      );

      const result = await service.create('user-1', 'NEW_ORDER', {
        default: 'Title',
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'NEW_ORDER',
          title: { default: 'Title' },
        },
      });
      expect(result).toBeDefined();
    });

    it('returns null on error (fire-and-forget)', async () => {
      mockPrisma.notification.create.mockRejectedValue(new Error('DB error'));

      const result = await service.create('user-1', 'NEW_ORDER', {
        default: 'Title',
      });

      expect(result).toBeNull();
    });
  });

  // ── createForAllAdmins() ──────────────────────────────────────────────────

  describe('createForAllAdmins()', () => {
    it('creates notifications for all active admin users', async () => {
      const admins = [{ id: 'admin-1' }, { id: 'admin-2' }, { id: 'admin-3' }];
      mockPrisma.user.findMany.mockResolvedValue(admins);
      mockPrisma.notification.createMany.mockResolvedValue({ count: 3 });

      await service.createForAllAdmins(
        'NEW_ORDER',
        { default: 'Title' },
        {
          default: 'Body',
        },
      );

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { role: 'ADMIN', isActive: true, deletedAt: null },
        select: { id: true },
      });
      expect(mockPrisma.notification.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ userId: 'admin-1', type: 'NEW_ORDER' }),
          expect.objectContaining({ userId: 'admin-2', type: 'NEW_ORDER' }),
          expect.objectContaining({ userId: 'admin-3', type: 'NEW_ORDER' }),
        ],
      });
    });

    it('returns early if no admins exist', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.createForAllAdmins('NEW_ORDER', { default: 'Title' });

      expect(mockPrisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('swallows errors (fire-and-forget)', async () => {
      mockPrisma.user.findMany.mockRejectedValue(new Error('DB error'));

      await expect(
        service.createForAllAdmins('NEW_ORDER', { default: 'Title' }),
      ).resolves.toBeUndefined();
    });
  });

  // ── listForUser() ──────────────────────────────────────────────────────────

  describe('listForUser()', () => {
    it('returns paginated notifications, unread first', async () => {
      const notifications = [
        makeNotification({ isRead: false }),
        makeNotification({ id: 'notif-2', isRead: true }),
      ];
      mockPrisma.notification.findMany.mockResolvedValue(notifications);
      mockPrisma.notification.count.mockResolvedValue(2);

      const result = await service.listForUser('user-1', {});

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          skip: 0,
          take: 20,
          orderBy: [{ isRead: 'asc' }, { createdAt: 'desc' }],
        }),
      );
      expect(result.data).toHaveLength(2);
      expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 2 });
    });

    it('filters by isRead when provided', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      await service.listForUser('user-1', { isRead: false });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', isRead: false },
        }),
      );
    });

    it('respects custom page and pageSize', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(50);

      const result = await service.listForUser('user-1', { page: 3, pageSize: 10 });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(result.meta).toEqual({ page: 3, pageSize: 10, total: 50 });
    });
  });

  // ── markRead() ─────────────────────────────────────────────────────────────

  describe('markRead()', () => {
    it('marks a notification as read with timestamp', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 });

      await service.markRead('notif-1', 'user-1');

      const call = mockPrisma.notification.updateMany.mock.calls[0];
      expect(call[0].where).toEqual({ id: 'notif-1', userId: 'user-1' });
      expect(call[0].data.isRead).toBe(true);
      expect(call[0].data.readAt).toBeInstanceOf(Date);
    });

    it('includes userId in where clause for ownership check', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });

      await service.markRead('notif-1', 'user-1');

      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif-1', userId: 'user-1' },
        }),
      );
    });
  });

  // ── markAllRead() ──────────────────────────────────────────────────────────

  describe('markAllRead()', () => {
    it('marks all unread notifications as read for a user', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 5 });

      await service.markAllRead('user-1');

      const call = mockPrisma.notification.updateMany.mock.calls[0];
      expect(call[0].where).toEqual({ userId: 'user-1', isRead: false });
      expect(call[0].data.isRead).toBe(true);
      expect(call[0].data.readAt).toBeInstanceOf(Date);
    });

    it('handles case where no unread notifications exist', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.markAllRead('user-1')).resolves.toBeUndefined();
    });
  });

  // ── getUnreadCount() ────────────────────────────────────────────────────────

  describe('getUnreadCount()', () => {
    it('returns count of unread notifications', async () => {
      mockPrisma.notification.count.mockResolvedValue(3);

      const count = await service.getUnreadCount('user-1');

      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', isRead: false },
      });
      expect(count).toBe(3);
    });

    it('returns 0 when no unread notifications', async () => {
      mockPrisma.notification.count.mockResolvedValue(0);

      const count = await service.getUnreadCount('user-1');

      expect(count).toBe(0);
    });
  });
});
