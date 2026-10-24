import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public, RateLimit } from '@common/decorators';
import { CheckoutService } from './checkout.service';

/**
 * Public checkout bootstrap surface.
 *
 * Until this existed the whole `checkout` settings group and the entire
 * payment-methods module were admin-only: an operator could toggle guest
 * checkout, write a checkout message, or enable a tender and nothing on the
 * storefront would ever read it (findings K3, D1, D3).
 *
 * `@Public()` short-circuits both the session guard and the permissions guard,
 * which is what an anonymous visitor standing at checkout needs. There is no
 * cache decorator on purpose: the API default is `no-store` (§3.15-A), and a
 * settings flip has to apply on the customer's next load, not after a TTL.
 */
@ApiTags('checkout')
@Controller('v1/checkout')
export class CheckoutStorefrontController {
  constructor(private readonly service: CheckoutService) {}

  @Get('settings')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({
    summary: 'Get the public checkout settings and the enabled payment methods',
  })
  @ApiResponse({ status: 200, description: 'Checkout bootstrap payload retrieved' })
  getSettings() {
    return this.service.getStorefrontSettings();
  }
}
