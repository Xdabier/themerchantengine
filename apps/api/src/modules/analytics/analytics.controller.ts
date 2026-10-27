import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { AnalyticsService } from './analytics.service';
import { AnalyticsDateQueryDto, TimeseriesQueryDto, UpdatePixelsAdminDto } from './dto';

/**
 * Admin analytics endpoints.
 * All routes require JWT + the appropriate analytics permission.
 */
@ApiTags('analytics')
@Controller(ADMIN_API_ROUTES.analytics.base)
export class AnalyticsAdminController {
  constructor(private readonly service: AnalyticsService) {}

  /**
   * Overview dashboard: order count, revenue, unique sessions, and conversion
   * rate for today, this week, and this month.
   */
  @Get(ADMIN_API_ROUTES.analytics.dashboard)
  @Permissions('analytics:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Get overview dashboard metrics for today, week and month' })
  getDashboard() {
    return this.service.getDashboard();
  }

  /**
   * Conversion funnel: event counts and drop-off rates for each funnel stage
   * (product_view → purchase). Filterable by date range.
   */
  @Get(ADMIN_API_ROUTES.analytics.funnel)
  @Permissions('analytics:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Get conversion funnel counts and drop-off rates' })
  getFunnel(@Query() dto: AnalyticsDateQueryDto) {
    return this.service.getFunnel(dto);
  }

  /**
   * Product performance table: views, add-to-carts, purchases, conversion
   * rates, and revenue per product. Filterable by date range.
   */
  @Get(ADMIN_API_ROUTES.analytics.products)
  @Permissions('analytics:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Get per-product performance metrics' })
  getProductAnalytics(@Query() dto: AnalyticsDateQueryDto) {
    return this.service.getProductAnalytics(dto);
  }

  /**
   * Revenue breakdown: gross/net revenue, AOV, discounts, refunds,
   * unique sessions, and revenue-per-visitor. Filterable by date range.
   */
  @Get(ADMIN_API_ROUTES.analytics.revenue)
  @Permissions('analytics:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Get revenue breakdown metrics' })
  getRevenueAnalytics(@Query() dto: AnalyticsDateQueryDto) {
    return this.service.getRevenueAnalytics(dto);
  }

  /**
   * Customer analytics: total, new vs returning, retention rate,
   * and average revenue per customer. Filterable by date range.
   */
  @Get(ADMIN_API_ROUTES.analytics.customers)
  @Permissions('analytics:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Get customer acquisition and retention metrics' })
  getCustomerAnalytics(@Query() dto: AnalyticsDateQueryDto) {
    return this.service.getCustomerAnalytics(dto);
  }

  /**
   * Search analytics: total search event count and top query terms.
   * Derived from search-type analytics events. Filterable by date range.
   */
  @Get(ADMIN_API_ROUTES.analytics.search)
  @Permissions('analytics:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Get search event counts and top query terms' })
  getSearchAnalytics(@Query() dto: AnalyticsDateQueryDto) {
    return this.service.getSearchAnalytics(dto);
  }

  /**
   * Bucketed time series for sparklines and trend charts. Supports `orders`,
   * `revenue`, and `sessions` metrics. Granularity defaults sensibly to
   * `hour` (≤ 48h window), `day` (≤ 90d), or `week` (larger). Zero-count
   * buckets are returned so the client can render a continuous line.
   */
  @Get(ADMIN_API_ROUTES.analytics.timeseries)
  @Permissions('analytics:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Get bucketed time series for orders, revenue or sessions' })
  getTimeseries(@Query() dto: TimeseriesQueryDto) {
    return this.service.getTimeseries(dto);
  }

  /**
   * Returns the current pixel configuration
   * (Google Analytics, Meta, TikTok, Snap pixel IDs).
   */
  @Get(ADMIN_API_ROUTES.analytics.pixels)
  @Permissions('analytics:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Get tracking pixel configuration' })
  getPixels() {
    return this.service.getPixels().then((data) => ({ data }));
  }

  /**
   * Updates pixel configuration. Supply only the keys to change;
   * send an empty string for a key to clear it.
   */
  @Patch(ADMIN_API_ROUTES.analytics.pixels)
  @Permissions('analytics:manage')
  @RateLimit.Admin()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update tracking pixel configuration' })
  updatePixels(@Body() dto: UpdatePixelsAdminDto) {
    return this.service.updatePixels(dto).then((data) => ({ data }));
  }
}
