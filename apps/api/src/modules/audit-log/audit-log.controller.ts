import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { AuditLogService } from './audit-log.service';
import { ListAuditLogDto } from './dto';

@ApiTags('auditlog')
@Controller(ADMIN_API_ROUTES.auditLog.base)
export class AuditLogAdminController {
  constructor(private readonly service: AuditLogService) {}

  /**
   * Search the audit log.
   * Filterable by userId, entityType, action (partial match), and date range.
   */
  @Get()
  @Permissions('audit_log:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Search audit log entries' })
  list(@Query() dto: ListAuditLogDto) {
    return this.service.list(dto);
  }

  /** All audit log entries for a specific entity, newest first. */
  @Get(ADMIN_API_ROUTES.auditLog.byEntity)
  @Permissions('audit_log:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'List audit log entries for one entity' })
  getByEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Query() dto: ListAuditLogDto,
  ) {
    return this.service.getByEntity(entityType, entityId, dto);
  }
}
