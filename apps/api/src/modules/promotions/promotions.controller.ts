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
import { PromotionsService } from './promotions.service';
import { CreatePromotionAdminDto } from './dto/create-promotion.dto';
import { UpdatePromotionAdminDto } from './dto/update-promotion.dto';
import { ListPromotionsAdminDto } from './dto/query-promotion.dto';
import { GetAutomaticPromotionsDto, ValidateCouponDto } from './dto/validate-coupon.dto';

@ApiTags('promotions')
@Controller(ADMIN_API_ROUTES.promotions.base)
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  // ── Storefront ─────────────────────────────────────────────────────────────

  /**
   * Validates a coupon code against a cart and returns the calculated discount.
   * Returns a generic 400 on any invalid coupon — reason is never leaked.
   */
  @Post('promotions/validate-coupon')
  @Public()
  @RateLimit.StorefrontWrite()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate coupon code' })
  @ApiResponse({ status: 200, description: 'Coupon validated' })
  @ApiResponse({ status: 400, description: 'Invalid coupon' })
  validateCoupon(@Body() dto: ValidateCouponDto) {
    return this.promotionsService.validateCoupon(dto.code, dto.subtotal, dto.items, dto.userId);
  }

  /**
   * Returns all applicable automatic promotions for a cart, with stacking rules applied.
   */
  @Post('promotions/automatic')
  @Public()
  @RateLimit.StorefrontWrite()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get automatic promotions' })
  @ApiResponse({ status: 200, description: 'Promotions retrieved' })
  getApplicableAutomatic(@Body() dto: GetAutomaticPromotionsDto) {
    return this.promotionsService.getApplicableAutomatic(dto.subtotal, dto.items, dto.userId);
  }

  // ── Admin: Promotions ──────────────────────────────────────────────────────

  /** Paginated list of promotions, filterable by type, applicationMethod, and isActive. */
  @Get(ADMIN_API_ROUTES.promotions.adminList)
  @Permissions('promotions:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List promotions' })
  @ApiResponse({ status: 200, description: 'Promotions retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  list(@Query() query: ListPromotionsAdminDto) {
    return this.promotionsService.list(query);
  }

  /** Fetch a single promotion with its eligibility joins. */
  @Get(ADMIN_API_ROUTES.promotions.adminById)
  @Permissions('promotions:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get promotion' })
  @ApiResponse({ status: 200, description: 'Promotion retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Promotion not found' })
  findOne(@Param('id') id: string) {
    return this.promotionsService.findOne(id);
  }

  /** Create a new promotion with optional eligibility restrictions. */
  @Post(ADMIN_API_ROUTES.promotions.adminList)
  @Permissions('promotions:create')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create promotion' })
  @ApiResponse({ status: 201, description: 'Promotion created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  create(@Body() dto: CreatePromotionAdminDto) {
    return this.promotionsService.create(dto);
  }

  /** Update a promotion's configuration or eligibility join records. */
  @Patch(ADMIN_API_ROUTES.promotions.adminById)
  @Permissions('promotions:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update promotion' })
  @ApiResponse({ status: 200, description: 'Promotion updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Promotion not found' })
  update(@Param('id') id: string, @Body() dto: UpdatePromotionAdminDto) {
    return this.promotionsService.update(id, dto);
  }

  /** Soft-deactivates a promotion (sets isActive=false, deletedAt=now). */
  @Delete(ADMIN_API_ROUTES.promotions.adminById)
  @Permissions('promotions:delete')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate promotion' })
  @ApiResponse({ status: 204, description: 'Promotion deactivated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Promotion not found' })
  deactivate(@Param('id') id: string) {
    return this.promotionsService.deactivate(id);
  }
}
