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
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import {
  IdempotencyKey,
  IdempotencyKeyPipe,
} from '../../common/decorators/idempotency-key.decorator';
import { InventoryService } from './inventory.service';
import { AdjustInventoryAdminDto } from './dto/adjust-inventory.dto';
import { TransferInventoryAdminDto } from './dto/transfer-inventory.dto';
import { ListStockLevelsAdminDto, ListMovementsAdminDto } from './dto/query-inventory.dto';
import { CreateInventoryLocationAdminDto } from './dto/create-location.dto';
import { UpdateInventoryLocationAdminDto } from './dto/update-location.dto';

@ApiTags('inventory')
@Controller(ADMIN_API_ROUTES.inventory.base)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ── Stock levels ──────────────────────────────────────────────────────────

  /** Paginated stock level list with optional low-stock / out-of-stock / location filters. */
  @Get(ADMIN_API_ROUTES.inventory.list)
  @Permissions('inventory:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List stock levels' })
  @ApiResponse({ status: 200, description: 'Stock levels retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listStockLevels(@Query() query: ListStockLevelsAdminDto) {
    return this.inventoryService.listStockLevels(query);
  }

  /** Per-location stock breakdown for a single variant. */
  @Get(ADMIN_API_ROUTES.inventory.variant)
  @Permissions('inventory:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get variant stock levels' })
  @ApiResponse({ status: 200, description: 'Stock levels retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  getVariantStock(@Param('variantId') variantId: string) {
    return this.inventoryService.getVariantStockDetail(variantId);
  }

  // ── Manual adjustment ─────────────────────────────────────────────────────

  /** Apply a positive or negative stock adjustment with a required reason code. */
  @Patch(ADMIN_API_ROUTES.inventory.adjust)
  @Permissions('inventory:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Adjust inventory stock' })
  @ApiResponse({ status: 200, description: 'Inventory adjusted' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  adjustInventory(
    @Body() dto: AdjustInventoryAdminDto,
    @Req() req: { user: { id: string } },
    @IdempotencyKey(IdempotencyKeyPipe) idempotencyKey: string,
  ) {
    return this.inventoryService.adjustInventory(dto, req.user.id, idempotencyKey);
  }

  // ── Transfer ──────────────────────────────────────────────────────────────

  /** Move stock from one location to another. Atomic — logs two movements. */
  @Post(ADMIN_API_ROUTES.inventory.transfer)
  @Permissions('inventory:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transfer inventory between locations' })
  @ApiResponse({ status: 200, description: 'Inventory transferred' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Location or variant not found' })
  transferInventory(
    @Body() dto: TransferInventoryAdminDto,
    @Req() req: { user: { id: string } },
    @IdempotencyKey(IdempotencyKeyPipe) idempotencyKey: string,
  ) {
    return this.inventoryService.transferInventory(dto, req.user.id, idempotencyKey);
  }

  // ── Alerts ────────────────────────────────────────────────────────────────

  /** Paginated list of low-stock and out-of-stock alerts (stock <= LOW_STOCK_THRESHOLD). */
  @Get(ADMIN_API_ROUTES.inventory.alerts)
  @Permissions('inventory:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List low/out-of-stock alerts' })
  @ApiResponse({ status: 200, description: 'Alerts retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listAlerts(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.inventoryService.listAlerts(
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  // ── Movement log ──────────────────────────────────────────────────────────

  /** Immutable movement log. Filterable by variant, type, and date range. */
  @Get(ADMIN_API_ROUTES.inventory.movements)
  @Permissions('inventory:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List inventory movements' })
  @ApiResponse({ status: 200, description: 'Movements retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listMovements(@Query() query: ListMovementsAdminDto) {
    return this.inventoryService.listMovements(query);
  }

  // ── Locations CRUD ────────────────────────────────────────────────────────

  /** List all inventory locations (warehouses, stores, 3PL). */
  @Get(ADMIN_API_ROUTES.inventory.locations)
  @Permissions('inventory:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List inventory locations' })
  @ApiResponse({ status: 200, description: 'Locations retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listLocations(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.inventoryService.listLocations(
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  /** Create a new inventory location. */
  @Post(ADMIN_API_ROUTES.inventory.locations)
  @Permissions('inventory:create')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create inventory location' })
  @ApiResponse({ status: 201, description: 'Location created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  createLocation(@Body() dto: CreateInventoryLocationAdminDto) {
    return this.inventoryService.createLocation(dto);
  }

  /** Update name, code, or active status of a location. */
  @Patch(ADMIN_API_ROUTES.inventory.locationById)
  @Permissions('inventory:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update inventory location' })
  @ApiResponse({ status: 200, description: 'Location updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Location not found' })
  updateLocation(@Param('id') id: string, @Body() dto: UpdateInventoryLocationAdminDto) {
    return this.inventoryService.updateLocation(id, dto);
  }

  /** Delete a location. Blocked if any variant holds stock there. */
  @Delete(ADMIN_API_ROUTES.inventory.locationById)
  @Permissions('inventory:delete')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete inventory location' })
  @ApiResponse({ status: 204, description: 'Location deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Location not found' })
  @ApiResponse({ status: 409, description: 'Location has stock' })
  deleteLocation(@Param('id') id: string) {
    return this.inventoryService.deleteLocation(id);
  }
}
