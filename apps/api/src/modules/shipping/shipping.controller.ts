import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Permissions, Public, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { ShippingService } from './shipping.service';
import { CreateShippingZoneAdminDto } from './dto/create-zone.dto';
import { UpdateShippingZoneAdminDto } from './dto/update-zone.dto';
import { CreateShippingMethodAdminDto } from './dto/create-method.dto';
import { UpdateShippingMethodAdminDto } from './dto/update-method.dto';
import { ListZonesAdminDto, ListMethodsAdminDto } from './dto/query-shipping.dto';
import { CalculateRatesDto } from './dto/calculate-rates.dto';

@ApiTags('shipping')
@Controller(ADMIN_API_ROUTES.shipping.base)
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Post('shipping/rates')
  @Public()
  @RateLimit.StorefrontWrite()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calculate shipping rates' })
  @ApiResponse({ status: 200, description: 'Rates calculated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  calculateRates(@Body() dto: CalculateRatesDto) {
    return this.shippingService.calculateRates(dto);
  }

  @Get(ADMIN_API_ROUTES.shipping.zones)
  @Permissions('shipping:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List shipping zones' })
  @ApiResponse({ status: 200, description: 'Zones retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listZones(@Query() query: ListZonesAdminDto) {
    return this.shippingService.listZones(query);
  }

  @Post(ADMIN_API_ROUTES.shipping.zones)
  @Permissions('shipping:create')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create shipping zone' })
  @ApiResponse({ status: 201, description: 'Zone created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  createZone(@Body() dto: CreateShippingZoneAdminDto) {
    return this.shippingService.createZone(dto);
  }

  @Patch(ADMIN_API_ROUTES.shipping.zoneById)
  @Permissions('shipping:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update shipping zone' })
  @ApiResponse({ status: 200, description: 'Zone updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Zone not found' })
  updateZone(@Param('id') id: string, @Body() dto: UpdateShippingZoneAdminDto) {
    return this.shippingService.updateZone(id, dto);
  }

  @Get(ADMIN_API_ROUTES.shipping.methods)
  @Permissions('shipping:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List shipping methods' })
  @ApiResponse({ status: 200, description: 'Methods retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listMethods(@Query() query: ListMethodsAdminDto) {
    return this.shippingService.listMethods(query);
  }

  @Post(ADMIN_API_ROUTES.shipping.methods)
  @Permissions('shipping:create')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create shipping method' })
  @ApiResponse({ status: 201, description: 'Method created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  createMethod(@Body() dto: CreateShippingMethodAdminDto) {
    return this.shippingService.createMethod(dto);
  }

  @Patch(ADMIN_API_ROUTES.shipping.methodById)
  @Permissions('shipping:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update shipping method' })
  @ApiResponse({ status: 200, description: 'Method updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Method not found' })
  updateMethod(@Param('id') id: string, @Body() dto: UpdateShippingMethodAdminDto) {
    return this.shippingService.updateMethod(id, dto);
  }

  @Delete(ADMIN_API_ROUTES.shipping.methodById)
  @Permissions('shipping:delete')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete shipping method' })
  @ApiResponse({ status: 204, description: 'Method deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Method not found' })
  deleteMethod(@Param('id') id: string) {
    return this.shippingService.deleteMethod(id);
  }
}
