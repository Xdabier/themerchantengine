/**
 * Customer-facing notification-preference endpoints (NE7).
 *
 * `/v1/users/me/notification-preferences` mirrors the existing `/v1/users/me`
 * surface (`users.controller.ts:44-68`): `@OwnerGuard()` + the global
 * SessionAuthGuard resolve `req.user.id`, so a customer only ever reads/writes
 * their OWN consent map.
 */
import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { OwnerGuard, RateLimit } from '@common/decorators';
import { NotificationPreferenceService } from './notification-preference.service';
import { UpdateNotificationPreferencesDto } from './dto/notification-preference.dto';

interface AuthenticatedRequest extends Request {
  user: { id: string; role: string; permissions: string[] };
}

@ApiTags('notification-preferences')
@Controller('v1')
export class NotificationPreferenceController {
  constructor(private readonly preferences: NotificationPreferenceService) {}

  @Get('users/me/notification-preferences')
  @OwnerGuard()
  @RateLimit.StorefrontRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current customer notification-consent map' })
  @ApiResponse({ status: 200, description: 'Consent map retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getPreferences(@Req() req: AuthenticatedRequest) {
    return this.preferences.getPreferences(req.user.id);
  }

  @Patch('users/me/notification-preferences')
  @OwnerGuard()
  @RateLimit.StorefrontWrite()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update the current customer notification-consent map' })
  @ApiResponse({ status: 200, description: 'Consent map updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  updatePreferences(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.preferences.updatePreferences(req.user.id, dto);
  }
}
