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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { CarriersService } from './carriers.service';
import { CreateCarrierDto } from './dto/create-carrier.dto';
import { ListCarriersDto } from './dto/query-carriers.dto';
import { UpdateCarrierDto } from './dto/update-carrier.dto';

@ApiTags('carriers')
@Controller(ADMIN_API_ROUTES.carriers.base)
export class CarriersController {
  constructor(private readonly service: CarriersService) {}

  @Get()
  @Permissions('carriers:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List carriers' })
  @ApiResponse({ status: 200, description: 'Carriers retrieved' })
  list(@Query() query: ListCarriersDto) {
    return this.service.list(query);
  }

  @Get(ADMIN_API_ROUTES.carriers.byId)
  @Permissions('carriers:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get carrier' })
  @ApiResponse({ status: 200, description: 'Carrier retrieved' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Permissions('carriers:create')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create carrier' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 409, description: 'Code already in use' })
  create(@Body() dto: CreateCarrierDto) {
    return this.service.create(dto);
  }

  @Patch(ADMIN_API_ROUTES.carriers.byId)
  @Permissions('carriers:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update carrier' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 404, description: 'Not found' })
  update(@Param('id') id: string, @Body() dto: UpdateCarrierDto) {
    return this.service.update(id, dto);
  }

  @Delete(ADMIN_API_ROUTES.carriers.byId)
  @Permissions('carriers:delete')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete carrier' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.service.remove(id);
  }
}
