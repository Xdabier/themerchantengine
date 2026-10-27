import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { CheckoutService } from './checkout.service';
import { UpdateCheckoutSettingsDto } from './dto/update-checkout-settings.dto';

@ApiTags('checkout')
@Controller(ADMIN_API_ROUTES.checkout.base)
export class CheckoutController {
  constructor(private readonly service: CheckoutService) {}

  @Get(ADMIN_API_ROUTES.checkout.settings)
  @Permissions('checkout:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get checkout settings' })
  @ApiResponse({ status: 200, description: 'Settings retrieved' })
  getSettings() {
    return this.service.getSettings();
  }

  @Patch(ADMIN_API_ROUTES.checkout.settings)
  @Permissions('checkout:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update checkout settings' })
  @ApiResponse({ status: 200, description: 'Settings updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  updateSettings(@Body() dto: UpdateCheckoutSettingsDto) {
    return this.service.updateSettings(dto);
  }
}
