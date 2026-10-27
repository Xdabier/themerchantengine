/**
 * Payment provider inbound webhook endpoint (DR-34).
 *
 * Public (the provider signature is the auth), rate-limit skipped (providers
 * retry at least once), and 200 on every verified event, replays included, so
 * the provider stops delivering it. `req.rawBody` is captured in
 * `apps/api/src/main.ts` before the global JSON parser so the provider checks
 * the exact signed bytes.
 */
import { Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public, RateLimit } from '@common/decorators';
import { PaymentWebhookService } from './payment-webhook.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@ApiTags('webhooks')
@Controller('v1/webhooks')
export class PaymentWebhookController {
  constructor(private readonly service: PaymentWebhookService) {}

  @Post('payments/:providerId')
  @Public()
  @RateLimit.Skip()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handle(
    @Param('providerId') providerId: string,
    @Req() req: RawBodyRequest,
  ): Promise<{ ok: true; replay: boolean }> {
    return this.service.process(providerId, req.headers, req.rawBody ?? Buffer.alloc(0));
  }
}
