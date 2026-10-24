/**
 * Resend inbound webhook endpoint.
 *
 * Public (signature is the auth), rate-limit skipped (Resend's at-least-once
 * retry loop would otherwise hit the throttler), responds 200 on every
 * successful verify even when the event was a replay so Resend stops
 * delivering it.
 *
 * Raw body capture: registered in `apps/api/src/main.ts` BEFORE the global
 * `express.json()` parser so `req.rawBody` is a Buffer of the exact bytes
 * Resend signed. The controller picks it off the request object.
 */
import { Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public, RateLimit } from '@common/decorators';
import { ResendWebhookService } from './resend-webhook.service';

/** Augmented request shape — `rawBody` is populated by main.ts middleware. */
type RawBodyRequest = Request & { rawBody?: Buffer };

@ApiTags('webhooks')
@Controller('v1/webhooks')
export class ResendWebhookController {
  constructor(private readonly service: ResendWebhookService) {}

  /**
   * Resend → us. No auth header — the Svix signature on the body is the
   * trust boundary. ApiExcludeEndpoint keeps this off the customer-facing
   * Swagger doc.
   */
  @Post('resend')
  @Public()
  @RateLimit.Skip()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handle(
    @Req() req: RawBodyRequest,
    @Headers('svix-id') svixId: string | undefined,
    @Headers('svix-timestamp') svixTimestamp: string | undefined,
    @Headers('svix-signature') svixSignature: string | undefined,
  ): Promise<{ ok: true; replay: boolean }> {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : '';
    return this.service.process({ raw, svixId, svixTimestamp, svixSignature });
  }
}
