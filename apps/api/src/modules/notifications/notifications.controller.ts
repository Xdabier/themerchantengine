import { Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { NotificationsService } from './notifications.service';
import { ListNotificationsDto } from './dto';

@ApiTags('notifications')
@Controller(ADMIN_API_ROUTES.notifications.base)
export class NotificationsAdminController {
  constructor(private readonly service: NotificationsService) {}

  /**
   * List notifications for the requesting admin user.
   * Unread notifications appear first, then ordered by recency.
   */
  @Get()
  @Permissions('notifications:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'List notifications for the current admin user' })
  list(@Req() req: Request & { user?: { id?: string } }, @Query() dto: ListNotificationsDto) {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('Unauthorized');
    }
    return this.service.listForUser(userId, dto);
  }

  /**
   * Mark a specific notification as read.
   * Uses userId from request context to ensure users can only mark their own.
   */
  @Patch(ADMIN_API_ROUTES.notifications.read)
  @Permissions('notifications:manage')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Mark one notification as read' })
  async markRead(
    @Param('id') notificationId: string,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('Unauthorized');
    }
    await this.service.markRead(notificationId, userId);
    return { success: true };
  }

  /**
   * Mark all unread notifications as read for the requesting user.
   */
  @Patch(ADMIN_API_ROUTES.notifications.readAll)
  @Permissions('notifications:manage')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllRead(@Req() req: Request & { user?: { id?: string } }) {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('Unauthorized');
    }
    await this.service.markAllRead(userId);
    return { success: true };
  }

  /**
   * Get count of unread notifications for the requesting user.
   */
  @Get(ADMIN_API_ROUTES.notifications.unreadCount)
  @Permissions('notifications:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Get unread notification count' })
  async getUnreadCount(@Req() req: Request & { user?: { id?: string } }) {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('Unauthorized');
    }
    const count = await this.service.getUnreadCount(userId);
    return { unreadCount: count };
  }
}
