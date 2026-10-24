import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { GeoService } from './geo.service';
import { AcceptFaqSuggestionsDto } from './dto';

@ApiTags('geo')
@Controller(ADMIN_API_ROUTES.geo.base)
export class GeoAdminController {
  constructor(private readonly service: GeoService) {}

  /**
   * AI-readiness score across all active products.
   * Returns overall percentage + per-signal breakdown:
   *   - answerFirstDescription (description ≥ 100 chars)
   *   - faqEntries (at least 1 FAQ)
   *   - completeSchemaMarkup (metaTitle + metaDescription set)
   */
  @Get(ADMIN_API_ROUTES.geo.aiReadiness)
  @Permissions('geo:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Get AI-readiness score across active products' })
  getAiReadiness() {
    return this.service.getAiReadinessScore();
  }

  /**
   * Returns up to 3 generic FAQ suggestions for a product with no FAQs.
   * Returns an empty array if the product already has FAQs.
   */
  @Get(ADMIN_API_ROUTES.geo.faqSuggestions)
  @Permissions('geo:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Get generic FAQ suggestions for a product' })
  getFaqSuggestions(@Param('productId') productId: string) {
    return this.service.getFaqSuggestions(productId);
  }

  /**
   * Accepts (and optionally edits) suggested FAQs, persisting them as ProductFaq records.
   * Idempotent: no-op if the product already has FAQs.
   */
  @Post(ADMIN_API_ROUTES.geo.faqAccept)
  @Permissions('geo:create')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Accept FAQ suggestions as product FAQs' })
  acceptFaqSuggestions(
    @Param('productId') productId: string,
    @Body() dto: AcceptFaqSuggestionsDto,
  ) {
    return this.service.acceptFaqSuggestions(productId, dto);
  }
}
