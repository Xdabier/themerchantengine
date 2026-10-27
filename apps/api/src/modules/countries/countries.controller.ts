import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { CountriesService } from './countries.service';
import { UpdateEnabledCountriesDto } from './dto/update-countries.dto';

@ApiTags('countries')
@Controller(ADMIN_API_ROUTES.countries.base)
export class CountriesController {
  constructor(private readonly service: CountriesService) {}

  @Get()
  @Permissions('settings:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List countries with enabled/default flags' })
  @ApiResponse({ status: 200, description: 'Countries retrieved' })
  list() {
    return this.service.list();
  }

  @Patch()
  @Permissions('settings:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk update enabled countries + default' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 400, description: 'Empty enabled list or default not in enabled set' })
  update(@Body() dto: UpdateEnabledCountriesDto) {
    return this.service.update(dto);
  }
}
