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
import { Request } from 'express';
import { OwnerGuard, Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';

import { UsersService } from './users.service';
import {
  UpdateProfileDto,
  CreateAddressDto,
  UpdateAddressDto,
  SetDefaultAddressDto,
  ListCustomersQueryDto,
  UpdateCustomerAdminDto,
  CreateStaffDto,
  UpdateStaffDto,
  ListStaffQueryDto,
  CreateRoleDto,
  UpdateRolePermissionsDto,
} from './dto';

interface AuthenticatedRequest extends Request {
  user: { id: string; role: string; permissions: string[] };
}

@ApiTags('users')
@Controller(ADMIN_API_ROUTES.users.base)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ── Customer: Profile ────────────────────────────────────────────────────

  @Get('users/me')
  @OwnerGuard()
  @RateLimit.StorefrontRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getProfile(@Req() req: AuthenticatedRequest) {
    return this.usersService.getProfile(req.user.id);
  }

  @Patch('users/me')
  @OwnerGuard()
  @RateLimit.StorefrontWrite()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user profile' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  updateProfile(@Req() req: AuthenticatedRequest, @Body() dto: UpdateProfileDto) {
    // Forward the request headers so the service can route an email change
    // through Better Auth's verified change-email flow with the caller's
    // session (NE5 security fix).
    return this.usersService.updateProfile(req.user.id, dto, req.headers);
  }

  // ── Customer: Addresses ──────────────────────────────────────────────────

  @Post('users/me/addresses')
  @OwnerGuard()
  @RateLimit.StorefrontWrite()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create new address' })
  @ApiResponse({ status: 201, description: 'Address created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid address data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  createAddress(@Req() req: AuthenticatedRequest, @Body() dto: CreateAddressDto) {
    return this.usersService.createAddress(req.user.id, dto);
  }

  @Patch('users/me/addresses/:addressId')
  @OwnerGuard()
  @RateLimit.StorefrontWrite()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update address' })
  @ApiResponse({ status: 200, description: 'Address updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid address data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Address not found' })
  updateAddress(
    @Req() req: AuthenticatedRequest,
    @Param('addressId') addressId: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.usersService.updateAddress(req.user.id, addressId, dto);
  }

  @Delete('users/me/addresses/:addressId')
  @OwnerGuard()
  @RateLimit.StorefrontWrite()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete address' })
  @ApiResponse({ status: 204, description: 'Address deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Address not found' })
  deleteAddress(@Req() req: AuthenticatedRequest, @Param('addressId') addressId: string) {
    return this.usersService.deleteAddress(req.user.id, addressId);
  }

  @Patch('users/me/addresses/:addressId/default')
  @OwnerGuard()
  @RateLimit.StorefrontWrite()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set address as default' })
  @ApiResponse({ status: 200, description: 'Default address updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Address not found' })
  setDefaultAddress(
    @Req() req: AuthenticatedRequest,
    @Param('addressId') addressId: string,
    @Body() dto: SetDefaultAddressDto,
  ) {
    return this.usersService.setDefaultAddress(req.user.id, addressId, dto);
  }

  // ── Admin: Customers ─────────────────────────────────────────────────────

  @Get(ADMIN_API_ROUTES.users.customers)
  @Permissions('customers:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all customers' })
  @ApiResponse({ status: 200, description: 'Customers retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listCustomers(@Query() query: ListCustomersQueryDto) {
    return this.usersService.listCustomers(query);
  }

  @Get(ADMIN_API_ROUTES.users.customerSegments)
  @Permissions('customers:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List customer segments with counts' })
  @ApiResponse({ status: 200, description: 'Segments retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listCustomerSegments() {
    return this.usersService.listCustomerSegments();
  }

  @Get(ADMIN_API_ROUTES.users.customerById)
  @Permissions('customers:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get customer by ID' })
  @ApiResponse({ status: 200, description: 'Customer retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  getCustomer(@Param('id') id: string) {
    return this.usersService.getCustomerById(id);
  }

  @Patch(ADMIN_API_ROUTES.users.customerById)
  @Permissions('customers:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update customer' })
  @ApiResponse({ status: 200, description: 'Customer updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  updateCustomer(@Param('id') id: string, @Body() dto: UpdateCustomerAdminDto) {
    return this.usersService.updateCustomer(id, dto);
  }

  // ── Admin: Staff ─────────────────────────────────────────────────────────

  @Get(ADMIN_API_ROUTES.users.staff)
  @Permissions('admin_users:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all staff members' })
  @ApiResponse({ status: 200, description: 'Staff members retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listStaff(@Query() query: ListStaffQueryDto) {
    return this.usersService.listStaff(query);
  }

  @Post(ADMIN_API_ROUTES.users.staff)
  @Permissions('admin_users:create')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create new staff member' })
  @ApiResponse({ status: 201, description: 'Staff member created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  createStaff(@Body() dto: CreateStaffDto) {
    return this.usersService.createStaff(dto);
  }

  @Patch(ADMIN_API_ROUTES.users.staffById)
  @Permissions('admin_users:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update staff member' })
  @ApiResponse({ status: 200, description: 'Staff member updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Staff member not found' })
  updateStaff(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.usersService.updateStaff(req.user.id, id, dto);
  }

  @Delete(ADMIN_API_ROUTES.users.staffById)
  @Permissions('admin_users:delete')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate staff member' })
  @ApiResponse({ status: 204, description: 'Staff member deactivated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Staff member not found' })
  deactivateStaff(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.usersService.deactivateStaff(req.user.id, id);
  }

  // ── Admin: Roles ─────────────────────────────────────────────────────────

  @Get(ADMIN_API_ROUTES.users.roles)
  @Permissions('admin_users:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all roles' })
  @ApiResponse({ status: 200, description: 'Roles retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listRoles() {
    return this.usersService.listRoles();
  }

  @Post(ADMIN_API_ROUTES.users.roles)
  @Permissions('admin_users:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create new role' })
  @ApiResponse({ status: 201, description: 'Role created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  createRole(@Body() dto: CreateRoleDto) {
    return this.usersService.createRole(dto);
  }

  @Patch(ADMIN_API_ROUTES.users.roleById)
  @Permissions('admin_users:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update role permissions' })
  @ApiResponse({ status: 200, description: 'Role permissions updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  updateRolePermissions(@Param('id') id: string, @Body() dto: UpdateRolePermissionsDto) {
    return this.usersService.updateRolePermissions(id, dto);
  }
}
