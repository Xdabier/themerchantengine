import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public, RateLimit } from '@common/decorators';
import { AnalyticsService } from './analytics.service';
import { IngestEventDto } from './dto';

/**
 * Public storefront endpoint for client-side analytics event ingestion.
 *
 * No authentication required — guest sessions must be able to send events.
 * Rate-limited to prevent abuse.
 */
@ApiTags('analytics')
@Controller('v1/analytics')
export class AnalyticsStorefrontController {
  constructor(private readonly service: AnalyticsService) {}

  /**
   * Ingest a single analytics event from the storefront.
   *
   * Supported event types: product_view, add_to_cart, begin_checkout,
   * add_shipping_info, add_payment_info, purchase, search.
   *
   * On `purchase` events the service asynchronously forwards to configured
   * server-side pixels (Meta CAPI, GA4 Measurement Protocol).
   */
  @Post('events')
  @Public()
  @RateLimit.StorefrontWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Ingest a storefront analytics event' })
  async ingestEvent(@Body() dto: IngestEventDto): Promise<void> {
    await this.service.ingestEvent(dto);
  }
}
