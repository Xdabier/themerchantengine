import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLogAdminController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';
import { AuditLogInterceptor } from './audit-log.interceptor';

@Module({
  controllers: [AuditLogAdminController],
  providers: [
    AuditLogService,
    // Registered as a DI-managed global interceptor so it can inject
    // AuditLogService and PrismaService. Runs inside ApiResponseInterceptor
    // (which is registered via useGlobalInterceptors in main.ts).
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
  ],
  exports: [AuditLogService],
})
export class AuditLogModule {}
