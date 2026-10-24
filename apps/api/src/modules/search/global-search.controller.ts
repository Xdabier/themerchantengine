import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { GlobalSearchDto } from './dto/global-search.dto';
import { GlobalSearchService } from './global-search.service';

@ApiTags('search-admin')
@Controller(ADMIN_API_ROUTES.globalSearch.base)
export class GlobalSearchController {
  constructor(private readonly service: GlobalSearchService) {}

  @Get()
  @Permissions('search:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cross-entity admin search' })
  @ApiResponse({ status: 200, description: 'Grouped search results' })
  search(@Query() query: GlobalSearchDto) {
    return this.service.search(query);
  }
}
