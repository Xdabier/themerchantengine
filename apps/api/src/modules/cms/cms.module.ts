import { Module } from '@nestjs/common';
import { CmsAdminController, CmsStorefrontController } from './cms.controller';
import { CmsService } from './cms.service';

@Module({
  controllers: [CmsStorefrontController, CmsAdminController],
  providers: [CmsService],
  exports: [CmsService],
})
export class CmsModule {}
