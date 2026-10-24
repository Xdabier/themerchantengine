import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { TaxService } from './tax.service';
import { CreateTaxZoneAdminDto } from './dto/create-zone.dto';
import { UpdateTaxZoneAdminDto } from './dto/update-zone.dto';
import { CreateTaxClassAdminDto } from './dto/create-class.dto';
import { ListTaxZonesAdminDto, ListTaxClassesAdminDto } from './dto/query-tax.dto';

@ApiTags('tax')
@Controller(ADMIN_API_ROUTES.tax.base)
export class TaxController {
  constructor(private readonly taxService: TaxService) {}

  @Get(ADMIN_API_ROUTES.tax.zones)
  @Permissions('settings:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List tax zones' })
  @ApiResponse({ status: 200, description: 'Zones retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listZones(@Query() query: ListTaxZonesAdminDto) {
    return this.taxService.listZones(query);
  }

  @Post(ADMIN_API_ROUTES.tax.zones)
  @Permissions('settings:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create tax zone' })
  @ApiResponse({ status: 201, description: 'Zone created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  createZone(@Body() dto: CreateTaxZoneAdminDto) {
    return this.taxService.createZone(dto);
  }

  @Get(ADMIN_API_ROUTES.tax.zoneById)
  @Permissions('settings:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get tax zone' })
  @ApiResponse({ status: 200, description: 'Zone retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Zone not found' })
  getZone(@Param('id') id: string) {
    return this.taxService.getZone(id);
  }

  @Patch(ADMIN_API_ROUTES.tax.zoneById)
  @Permissions('settings:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update tax zone' })
  @ApiResponse({ status: 200, description: 'Zone updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Zone not found' })
  updateZone(@Param('id') id: string, @Body() dto: UpdateTaxZoneAdminDto) {
    return this.taxService.updateZone(id, dto);
  }

  @Get(ADMIN_API_ROUTES.tax.classes)
  @Permissions('settings:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List tax classes' })
  @ApiResponse({ status: 200, description: 'Classes retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listClasses(@Query() query: ListTaxClassesAdminDto) {
    return this.taxService.listClasses(query);
  }

  @Post(ADMIN_API_ROUTES.tax.classes)
  @Permissions('settings:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create tax class' })
  @ApiResponse({ status: 201, description: 'Class created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  createClass(@Body() dto: CreateTaxClassAdminDto) {
    return this.taxService.createClass(dto);
  }
}
