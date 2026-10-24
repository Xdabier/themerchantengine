import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import Redis from 'ioredis';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsModule } from '../settings/settings.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { SettingsService } from '../settings/settings.service';
import { GeoService } from './geo.service';
import { GeoAdminController } from './geo.controller';
import { GeoStorefrontController } from './geo-storefront.controller';
import { GeoListener } from './geo.listener';
import { LlmsTxtProcessor } from './processors/llms-txt.processor';
import { ContentFreshnessProcessor } from './processors/content-freshness.processor';
import { GEO_CONTENT_FRESHNESS_QUEUE, GEO_LLMS_TXT_QUEUE, GEO_REDIS_CLIENT } from './geo.constants';

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({ name: GEO_LLMS_TXT_QUEUE }),
    BullModule.registerQueue({ name: GEO_CONTENT_FRESHNESS_QUEUE }),
    NotificationsModule,
    SettingsModule,
    // llms.txt advertises a price per product, so the GEO surface needs the
    // store currency rather than a literal.
    CurrenciesModule,
  ],
  controllers: [GeoStorefrontController, GeoAdminController],
  providers: [
    GeoService,
    GeoListener,
    LlmsTxtProcessor,
    ContentFreshnessProcessor,
    // Re-export NotificationsService under a stable token so GeoService
    // can inject it without a direct cross-module import in the constructor.
    {
      provide: 'GEO_NOTIFICATIONS_SERVICE',
      useExisting: NotificationsService,
    },
    // Re-export SettingsService under a stable token (same pattern) so the
    // llms.txt builder can resolve storeName + contactEmail via the canonical
    // two-tier lookup (DB override → store.config.ts default).
    {
      provide: 'GEO_SETTINGS_SERVICE',
      useExisting: SettingsService,
    },
    {
      provide: GEO_REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis =>
        new Redis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 56379),
          password: config.get<string>('REDIS_PASSWORD'),
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: true,
        }),
    },
  ],
  exports: [GeoService],
})
export class GeoModule {}
