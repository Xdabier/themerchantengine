import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AssetsModule } from '../assets/assets.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { SettingsModule } from '../settings/settings.module';
import {
  StorefrontConfigAdminController,
  StorefrontConfigStorefrontController,
} from './storefront-config.controller';
import { StorefrontConfigService } from './storefront-config.service';
import { StoreConfigComposer } from './store-config.composer';
import { StoreConfigController } from './store-config.controller';
import { STOREFRONT_CONFIG_REDIS_CLIENT } from './storefront-config.constants';

@Module({
  // The public config endpoint composes four owning modules through their
  // exported services; this module never reads their tables (§3.1).
  imports: [
    ConfigModule,
    forwardRef(() => AssetsModule),
    SettingsModule,
    CurrenciesModule,
    AnalyticsModule,
  ],
  controllers: [
    StorefrontConfigStorefrontController,
    StorefrontConfigAdminController,
    StoreConfigController,
  ],
  providers: [
    StorefrontConfigService,
    StoreConfigComposer,
    {
      provide: STOREFRONT_CONFIG_REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        return new Redis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 56379),
          password: config.get<string>('REDIS_PASSWORD'),
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: true,
        });
      },
    },
  ],
  exports: [StorefrontConfigService, StoreConfigComposer],
})
export class StorefrontConfigModule {}
