import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import Redis from 'ioredis';
import { SettingsModule } from '../settings/settings.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { SettingsService } from '../settings/settings.service';
import { ProductsModule } from '../products/products.module';
import { ProductsService } from '../products/products.service';
import { SeoService } from './seo.service';
import { SeoAdminController } from './seo.controller';
import { SeoStorefrontController } from './seo-storefront.controller';
import { SeoListener } from './seo.listener';
import { SeoRedirectMiddleware } from './seo-redirect.middleware';
import { SearchEngineSubmitService } from './search-engine-submit.service';
import { SeoSubmissionService } from './seo-submission.service';
import { SeoSubmitOrchestrator } from './seo-submit.orchestrator';
import { SeoInsightsService } from './seo-insights.service';
import { SitemapProcessor } from './processors/sitemap.processor';
import { GoogleMerchantFeedProcessor } from './processors/google-merchant-feed.processor';
import {
  SEO_PRODUCTS_SERVICE,
  SEO_REDIS_CLIENT,
  SEO_SETTINGS_SERVICE,
  SEO_SITEMAP_QUEUE,
  GOOGLE_MERCHANT_FEED_QUEUE,
} from './seo.constants';

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({ name: SEO_SITEMAP_QUEUE }),
    BullModule.registerQueue({ name: GOOGLE_MERCHANT_FEED_QUEUE }),
    SettingsModule,
    ProductsModule,
    // The Google Merchant feed reads the store currency rather than emitting a
    // hardcoded code: Google validates `g:price` against the account's target
    // currency, so a mismatched feed is rejected wholesale.
    CurrenciesModule,
  ],
  controllers: [SeoStorefrontController, SeoAdminController],
  providers: [
    SeoService,
    SeoListener,
    SearchEngineSubmitService,
    SeoSubmissionService,
    SeoSubmitOrchestrator,
    SeoInsightsService,
    SitemapProcessor,
    GoogleMerchantFeedProcessor,
    // Re-export SettingsService under a stable token (mirrors the GEO_SETTINGS_SERVICE
    // pattern at geo.module.ts:41 introduced in S23.6) so SeoStorefrontController and
    // SeoService can resolve `business.*` group values via the canonical two-tier
    // lookup (DB override → store.config.ts default) without coupling to the concrete
    // SettingsService class for testing.
    {
      provide: SEO_SETTINGS_SERVICE,
      useExisting: SettingsService,
    },
    // Re-export the products read service under a stable token so the submit
    // orchestrator resolves productIds → active slugs through the narrow
    // SeoProductsReader seam (§3.1) without coupling to the concrete class.
    {
      provide: SEO_PRODUCTS_SERVICE,
      useExisting: ProductsService,
    },
    {
      provide: SEO_REDIS_CLIENT,
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
  exports: [SeoService, SearchEngineSubmitService, SeoSubmissionService],
})
export class SeoModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SeoRedirectMiddleware).forRoutes({ path: '*', method: RequestMethod.GET });
  }
}
