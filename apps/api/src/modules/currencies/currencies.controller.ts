import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { AuthPermissionInsufficientException } from '../auth/auth-permission-insufficient.exception';
import { CurrenciesService } from './currencies.service';
import { UpdateEnabledCurrenciesDto } from './dto/update-currencies.dto';

@ApiTags('currencies')
@Controller(ADMIN_API_ROUTES.currencies.base)
export class CurrenciesController {
  constructor(private readonly service: CurrenciesService) {}

  @Get()
  @Permissions('settings:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List currencies with enabled/default flags' })
  @ApiResponse({ status: 200, description: 'Currencies retrieved' })
  list() {
    return this.service.list();
  }

  /**
   * Permission-free by design — no `@Permissions` (DR-26,
   * `specs/decision-records/26-store-currency-hydration-route.md`). Every admin
   * screen renders money, but the seeded Manager and Support roles hold no
   * `settings:*` permission, so gating this would leave them with unlabelled
   * amounts forever. `SessionAuthGuard` still rejects anonymous callers.
   *
   * Staff-only, though. One API process serves both the storefront and the
   * admin, so without this check a customer's session cookie would reach an
   * `/v1/admin/*` route: `PermissionsGuard` treats "no decorator" as "any
   * authenticated user", and that includes every self-registered customer.
   * The role check is what makes DR-26's "every operator" principal set true.
   *
   * permissions-waived: getStore - DR-26. Gating this on `settings:*` would
   * leave the seeded Manager and Support roles with unlabelled amounts on
   * every screen. SessionAuthGuard plus the in-handler role check is the
   * substitute, and both are asserted in the controller spec.
   */
  @Get(ADMIN_API_ROUTES.currencies.store)
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Store display currency + enabled set (any staff role)' })
  @ApiResponse({ status: 200, description: 'Store currency retrieved' })
  @ApiResponse({ status: 403, description: 'Customer session — not a staff role' })
  getStore(@Req() req: { user?: { role?: string } }) {
    if (req.user?.role === 'CUSTOMER') {
      throw new AuthPermissionInsufficientException();
    }
    return this.service.getStore();
  }

  @Patch()
  @Permissions('settings:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk update enabled currencies + default' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 400, description: 'Empty enabled list or default not in enabled set' })
  update(@Body() dto: UpdateEnabledCurrenciesDto) {
    return this.service.update(dto);
  }
}
