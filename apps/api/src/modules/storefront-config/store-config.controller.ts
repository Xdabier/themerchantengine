import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public, PublicCacheable, RateLimit } from '@common/decorators';
import type { StoreRuntimeConfig } from '@common/store-config-fixtures/store-config-fixture.schema';
import { StoreConfigComposer } from './store-config.composer';
import { STOREFRONT_PUBLIC_CONFIG_TTL_SECONDS } from './storefront-config.constants';

/**
 * The runtime store config (DR-31, plan E1.2): identity, brand, localization,
 * money and domains, in the shape `storeRuntimeConfigSchema` declares and the
 * scenario fixtures carry. Read by the storefront at SSR boot and by the
 * admin shell; supersedes the narrower `GET /v1/storefront/config`, which
 * stays until E2.6 moves the storefront over.
 *
 * `@Public()` because nothing on it is secret: every value renders into a
 * page any visitor can open. `@PublicCacheable`
 * per constitution §3.15-A: a browser may hold it for the same minute Redis
 * does, keyed on the two locale headers, ETag stays disabled app-wide, and a
 * settings write drops both caches.
 */
@ApiTags('store-config')
@Controller('v1/store')
export class StoreConfigController {
  constructor(private readonly composer: StoreConfigComposer) {}

  @Get('config')
  @Public()
  @RateLimit.StorefrontRead()
  // The Translatable fields are resolved per request from the two locale
  // headers, and left as objects under X-Resolve-Locale: false, so a shared
  // cache must key on all three or one reader's copy serves everyone.
  @PublicCacheable(
    STOREFRONT_PUBLIC_CONFIG_TTL_SECONDS,
    'X-Locale, Accept-Language, X-Resolve-Locale',
  )
  @ApiOperation({
    summary: 'The runtime store config: identity, brand, localization, money, domains',
  })
  @ApiResponse({ status: 200, description: 'Store config retrieved' })
  getConfig(): Promise<StoreRuntimeConfig> {
    return this.composer.getStoreConfig();
  }
}
