import { storeLocales } from '@common/locale';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Permissions, Public, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { SearchService } from './search.service';
import {
  SearchProductsDto,
  SuggestDto,
  LogClickDto,
  CreateSynonymDto,
  CreateMerchandisingRuleDto,
  SearchAnalyticsQueryDto,
  ListAdminDto,
} from './dto';

type AuthedRequest = { user?: { id: string }; headers: Record<string, string> };

/** First Accept-Language tag with its quality and region removed, so `fr-FR` reads `fr`. */
function requestLocale(req: AuthedRequest): string {
  const header = req.headers['accept-language'] ?? storeLocales.current().defaultLocale;
  return header.split(',')[0].split(';')[0].split('-')[0].trim().toLowerCase();
}

@ApiTags('search')
@Controller('v1/search')
export class SearchStorefrontController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'Search products' })
  @ApiResponse({ status: 200, description: 'Search results' })
  searchProducts(@Query() dto: SearchProductsDto, @Req() req: AuthedRequest) {
    const locale = requestLocale(req);
    const userId = req.user?.id;
    const sessionId = req.headers['x-session-id'];
    return this.search.search(dto, locale, userId, sessionId);
  }

  @Get('suggest')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'Get search suggestions' })
  @ApiResponse({ status: 200, description: 'Suggestions retrieved' })
  suggest(@Query() dto: SuggestDto, @Req() req: AuthedRequest) {
    const locale = requestLocale(req);
    return this.search.suggest(dto, locale);
  }

  @Get('filters')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'Get search filters' })
  @ApiResponse({ status: 200, description: 'Filters retrieved' })
  getFilters(@Query('q') q: string = '') {
    return this.search.getFilters(q);
  }

  @Post('events/:id/click')
  @Public()
  @RateLimit.StorefrontWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Log product click' })
  @ApiResponse({ status: 204, description: 'Click logged' })
  logClick(@Param('id') id: string, @Body() dto: LogClickDto) {
    return this.search.logClick(id, dto);
  }

  @Post('events/:id/convert')
  @Public()
  @RateLimit.StorefrontWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Log product conversion' })
  @ApiResponse({ status: 204, description: 'Conversion logged' })
  logConversion(@Param('id') id: string) {
    return this.search.logConversion(id);
  }
}

@ApiTags('search')
@Controller(ADMIN_API_ROUTES.search.base)
export class SearchAdminController {
  constructor(private readonly search: SearchService) {}

  @Get(ADMIN_API_ROUTES.search.analytics)
  @Permissions('analytics:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get search analytics' })
  @ApiResponse({ status: 200, description: 'Analytics retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  getAnalytics(@Query() dto: SearchAnalyticsQueryDto) {
    return this.search.getAnalytics(dto);
  }

  @Get(ADMIN_API_ROUTES.search.zeroResults)
  @Permissions('analytics:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List queries that returned zero results' })
  @ApiResponse({ status: 200, description: 'Zero-result queries retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  getZeroResults(
    @Query('period') period?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.search.getZeroResults(
      period ? parseInt(period, 10) : 30,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  @Post(ADMIN_API_ROUTES.search.reindex)
  @Permissions('products:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reindex search' })
  @ApiResponse({ status: 200, description: 'Reindex started' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  reindex() {
    return this.search.reindex();
  }

  @Post(ADMIN_API_ROUTES.search.synonyms)
  @Permissions('products:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create search synonym' })
  @ApiResponse({ status: 201, description: 'Synonym created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  createSynonym(@Body() dto: CreateSynonymDto) {
    return this.search.createSynonym(dto);
  }

  @Get(ADMIN_API_ROUTES.search.synonyms)
  @Permissions('products:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List search synonyms' })
  @ApiResponse({ status: 200, description: 'Synonyms retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listSynonyms(@Query() dto: ListAdminDto) {
    return this.search.listSynonyms(dto);
  }

  @Delete(ADMIN_API_ROUTES.search.synonymById)
  @Permissions('products:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete search synonym' })
  @ApiResponse({ status: 204, description: 'Synonym deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  deleteSynonym(@Param('id') id: string) {
    return this.search.deleteSynonym(id);
  }

  @Post(ADMIN_API_ROUTES.search.merchandising)
  @Permissions('products:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create merchandising rule' })
  @ApiResponse({ status: 201, description: 'Rule created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  createMerchandisingRule(@Body() dto: CreateMerchandisingRuleDto) {
    return this.search.createMerchandisingRule(dto);
  }

  @Get(ADMIN_API_ROUTES.search.merchandising)
  @Permissions('products:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List merchandising rules' })
  @ApiResponse({ status: 200, description: 'Rules retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listMerchandisingRules(@Query() dto: ListAdminDto) {
    return this.search.listMerchandisingRules(dto);
  }

  @Delete(ADMIN_API_ROUTES.search.merchandisingById)
  @Permissions('products:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete merchandising rule' })
  @ApiResponse({ status: 204, description: 'Rule deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  deleteMerchandisingRule(@Param('id') id: string) {
    return this.search.deleteMerchandisingRule(id);
  }
}
