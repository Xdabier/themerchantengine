import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { NotificationTemplatesService } from './notification-templates.service';
import { ListTemplatesDto } from './dto/query-templates.dto';
import { ListLogDto } from './dto/query-log.dto';
import {
  CreateNotificationTemplateDto,
  PreviewTemplateDto,
  SendTestTemplateDto,
  UpdateNotificationTemplateDto,
} from './dto/template.dto';

interface AuthenticatedRequest extends Request {
  user: { id: string; role: string; permissions: string[] };
}

@ApiTags('notifications-admin')
@Controller(ADMIN_API_ROUTES.notificationTemplates.base)
export class NotificationTemplatesController {
  constructor(private readonly service: NotificationTemplatesService) {}

  /** Order matters — /templates/log would otherwise shadow /templates/:id. */
  @Get(ADMIN_API_ROUTES.notificationTemplates.log)
  @Permissions('notifications:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List notification send-log entries' })
  @ApiResponse({ status: 200, description: 'Log retrieved' })
  listLog(@Query() query: ListLogDto) {
    return this.service.listLog(query);
  }

  @Post(ADMIN_API_ROUTES.notificationTemplates.logResend)
  @Permissions('notifications:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend a notification log entry' })
  @ApiResponse({ status: 200, description: 'Resend queued' })
  @ApiResponse({ status: 404, description: 'Log entry not found' })
  resend(@Param('id') id: string) {
    return this.service.resend(id);
  }

  @Get(ADMIN_API_ROUTES.notificationTemplates.templates)
  @Permissions('notifications:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List notification templates' })
  @ApiResponse({ status: 200, description: 'Templates retrieved' })
  listTemplates(@Query() query: ListTemplatesDto) {
    return this.service.listTemplates(query);
  }

  @Get(ADMIN_API_ROUTES.notificationTemplates.templateById)
  @Permissions('notifications:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get template' })
  @ApiResponse({ status: 200, description: 'Template retrieved' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post(ADMIN_API_ROUTES.notificationTemplates.templates)
  @Permissions('notifications:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create notification template' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 409, description: 'Code already in use' })
  create(@Body() dto: CreateNotificationTemplateDto) {
    return this.service.create(dto);
  }

  @Patch(ADMIN_API_ROUTES.notificationTemplates.templateById)
  @Permissions('notifications:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update notification template' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  update(@Param('id') id: string, @Body() dto: UpdateNotificationTemplateDto) {
    return this.service.update(id, dto);
  }

  @Post(ADMIN_API_ROUTES.notificationTemplates.templatePreview)
  @Permissions('notifications:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Render a draft template for every enabled locale (no send, no persist)',
  })
  @ApiResponse({ status: 200, description: 'Rendered preview' })
  @ApiResponse({ status: 400, description: 'Body references an undeclared variable' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  preview(@Param('id') id: string, @Body() dto: PreviewTemplateDto) {
    return this.service.preview(id, dto);
  }

  @Post(ADMIN_API_ROUTES.notificationTemplates.templateSendTest)
  @Permissions('notifications:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a test of this template to your own inbox' })
  @ApiResponse({ status: 200, description: 'Test enqueued (honest outcome)' })
  @ApiResponse({ status: 400, description: 'Non-email template or no recipient email' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  sendTest(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: SendTestTemplateDto,
  ) {
    return this.service.sendTest(id, req.user.id, dto);
  }

  @Delete(ADMIN_API_ROUTES.notificationTemplates.templateById)
  @Permissions('notifications:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete notification template' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.service.remove(id);
  }
}
