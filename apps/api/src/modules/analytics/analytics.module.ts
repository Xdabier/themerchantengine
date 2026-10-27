import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsAdminController } from './analytics.controller';
import { AnalyticsStorefrontController } from './analytics-storefront.controller';
import { MetaCapiService } from './services/meta-capi.service';
import { GaMpService } from './services/ga-mp.service';

@Module({
  controllers: [AnalyticsStorefrontController, AnalyticsAdminController],
  providers: [AnalyticsService, MetaCapiService, GaMpService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
