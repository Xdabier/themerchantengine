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
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { OwnerGuard, Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import {
  IdempotencyKey,
  IdempotencyKeyPipe,
} from '../../common/decorators/idempotency-key.decorator';
import { ReturnsService } from './returns.service';
import { CreateReturnDto } from './dto/create-return.dto';
import {
  ListReturnsStorefrontDto,
  ListReturnsAdminDto,
  ReturnsAnalyticsQueryDto,
} from './dto/query-returns.dto';
import { RejectReturnDto } from './dto/reject-return.dto';
import { ReceiveReturnDto } from './dto/receive-return.dto';
import { RefundReturnDto } from './dto/refund-return.dto';

type AuthedRequest = { user: { id: string } };

// ═══════════════════════════════════════════════════════════════════════════════
// STOREFRONT CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

@ApiTags('returns')
@Controller('v1')
export class ReturnsStorefrontController {
  constructor(private readonly returns: ReturnsService) {}

  // ── POST /v1/orders/:orderId/returns ─────────────────────────────────────

  @Post('orders/:orderId/returns')
  @OwnerGuard()
  @RateLimit.StorefrontWrite()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create return request' })
  @ApiResponse({ status: 201, description: 'Return created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  createReturn(
    @Param('orderId') orderId: string,
    @Body() dto: CreateReturnDto,
    @Req() req: AuthedRequest,
  ) {
    return this.returns.createReturn(orderId, dto, req.user.id);
  }

  // ── GET /v1/returns ───────────────────────────────────────────────────────

  @Get('returns')
  @OwnerGuard()
  @RateLimit.StorefrontRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List returns' })
  @ApiResponse({ status: 200, description: 'Returns retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  listReturns(@Req() req: AuthedRequest, @Query() query: ListReturnsStorefrontDto) {
    return this.returns.listStorefront(req.user.id, query);
  }

  // ── GET /v1/returns/:id ───────────────────────────────────────────────────

  @Get('returns/:id')
  @OwnerGuard()
  @RateLimit.StorefrontRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get return by ID' })
  @ApiResponse({ status: 200, description: 'Return retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Return not found' })
  findOne(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.returns.findOneStorefront(id, req.user.id);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

@ApiTags('returns')
@Controller(ADMIN_API_ROUTES.returns.base)
export class ReturnsAdminController {
  constructor(private readonly returns: ReturnsService) {}

  // ── GET /v1/admin/returns/analytics ──────────────────────────────────────

  @Get(ADMIN_API_ROUTES.returns.analytics)
  @Permissions('returns:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get returns analytics' })
  @ApiResponse({ status: 200, description: 'Analytics retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  getAnalytics(@Query() query: ReturnsAnalyticsQueryDto) {
    return this.returns.getAnalytics(query);
  }

  // ── GET /v1/admin/returns ─────────────────────────────────────────────────

  @Get()
  @Permissions('returns:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List returns (admin)' })
  @ApiResponse({ status: 200, description: 'Returns retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listReturns(@Query() query: ListReturnsAdminDto) {
    return this.returns.listAdmin(query);
  }

  // ── GET /v1/admin/returns/:id ─────────────────────────────────────────────

  @Get(ADMIN_API_ROUTES.returns.byId)
  @Permissions('returns:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get return by ID (admin)' })
  @ApiResponse({ status: 200, description: 'Return retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Return not found' })
  findOne(@Param('id') id: string) {
    return this.returns.findOneAdmin(id);
  }

  // ── PATCH /v1/admin/returns/:id/approve ──────────────────────────────────

  @Patch(ADMIN_API_ROUTES.returns.approve)
  @Permissions('returns:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve return' })
  @ApiResponse({ status: 200, description: 'Return approved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Return not found' })
  approveReturn(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.returns.approveReturn(id, req.user.id);
  }

  // ── PATCH /v1/admin/returns/:id/reject ───────────────────────────────────

  @Patch(ADMIN_API_ROUTES.returns.reject)
  @Permissions('returns:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject return' })
  @ApiResponse({ status: 200, description: 'Return rejected' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Return not found' })
  rejectReturn(@Param('id') id: string, @Body() dto: RejectReturnDto, @Req() req: AuthedRequest) {
    return this.returns.rejectReturn(id, dto, req.user.id);
  }

  // ── PATCH /v1/admin/returns/:id/receive ──────────────────────────────────

  @Patch(ADMIN_API_ROUTES.returns.receive)
  @Permissions('returns:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Receive return' })
  @ApiResponse({ status: 200, description: 'Return received' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Return not found' })
  receiveReturn(@Param('id') id: string, @Body() dto: ReceiveReturnDto, @Req() req: AuthedRequest) {
    return this.returns.receiveReturn(id, dto, req.user.id);
  }

  // ── PATCH /v1/admin/returns/:id/refund ───────────────────────────────────

  @Patch(ADMIN_API_ROUTES.returns.refund)
  @Permissions('returns:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Process return refund' })
  @ApiResponse({ status: 200, description: 'Refund processed' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Return not found' })
  processRefund(
    @Param('id') id: string,
    @Body() dto: RefundReturnDto,
    @Req() req: AuthedRequest,
    @IdempotencyKey(IdempotencyKeyPipe) idempotencyKey: string,
  ) {
    return this.returns.processRefund(id, dto, req.user.id, idempotencyKey);
  }

  // ── PATCH /v1/admin/returns/:id/close ────────────────────────────────────

  @Patch(ADMIN_API_ROUTES.returns.close)
  @Permissions('returns:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Close return' })
  @ApiResponse({ status: 200, description: 'Return closed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Return not found' })
  closeReturn(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.returns.closeReturn(id, req.user.id);
  }
}
