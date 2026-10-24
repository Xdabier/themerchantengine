// Canary fixture. Never registered in a Nest module.
import { Controller, Get, Post } from '@nestjs/common';
import { OptionalAuth, OwnerGuard, Permissions, Public } from '@common/decorators';

@Controller('v1')
export class AllowedController {
  @Get('admin/widgets')
  @Permissions('products:view')
  listWidgets() {
    return [];
  }

  /**
   * permissions-waived: readWidgetSettings - every staff role must read this to
   * render the screen, and the handler rejects a customer session by role.
   */
  @Get('admin/widgets/settings')
  readWidgetSettings() {
    return {};
  }

  @Get('widgets')
  @Public()
  publicList() {
    return [];
  }

  @Post('widgets/:id/claim')
  @OwnerGuard()
  claimWidget() {
    return {};
  }

  @Post('cart/widgets')
  @OptionalAuth()
  addToAnonymousCart() {
    return {};
  }
}
