import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICATIONS_DEFAULT_PAGE_SIZE } from './notifications.constants';
import { ListNotificationsDto } from './dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a notification for a user.
   * title and body are Translatable JSON objects.
   */
  async create(userId: string, type: string, title: object, body?: object, data?: object) {
    try {
      const notificationData: Prisma.NotificationUncheckedCreateInput = {
        userId,
        type,
        title,
        ...(body && { body }),
        ...(data && { data }),
      };

      const notification = await this.prisma.notification.create({
        data: notificationData,
      });
      return notification;
    } catch (err) {
      this.logger.error(`Failed to create notification for user ${userId}`, err);
      return null;
    }
  }

  /**
   * Create notifications for all admin users.
   * Fire-and-forget — errors are logged but not thrown.
   */
  async createForAllAdmins(
    type: string,
    title: object,
    body?: object,
    data?: object,
  ): Promise<void> {
    try {
      // Fetch all active admin users
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN', isActive: true, deletedAt: null },
        select: { id: true },
      });

      if (admins.length === 0) return;

      // Create one notification per admin
      await this.prisma.notification.createMany({
        data: admins.map((admin) => {
          const notifData: Prisma.NotificationCreateManyInput = {
            userId: admin.id,
            type,
            title,
            ...(body && { body }),
            ...(data && { data }),
          };
          return notifData;
        }),
      });

      this.logger.log(`Created ${type} notifications for ${admins.length} admins`);
    } catch (err) {
      this.logger.error(`Failed to create admin notifications: ${type}`, err);
    }
  }

  /** Paginated list of notifications for a user, unread first. */
  async listForUser(userId: string, dto: ListNotificationsDto) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? NOTIFICATIONS_DEFAULT_PAGE_SIZE;
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = { userId };
    if (dto.isRead !== undefined) {
      where['isRead'] = dto.isRead;
    }

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip,
        take: pageSize,
        // Unread first, then by createdAt descending
        orderBy: [{ isRead: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { data: items, meta: { page, pageSize, total } };
  }

  /** Mark a notification as read. */
  async markRead(notificationId: string, userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  /** Mark all unread notifications as read for a user. */
  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  /** Count unread notifications for a user. */
  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }
}
