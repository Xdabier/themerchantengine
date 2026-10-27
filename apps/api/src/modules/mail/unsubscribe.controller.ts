/**
 * Public one-click unsubscribe endpoint (NE7, RFC 8058).
 *
 * The `List-Unsubscribe` header on every marketing/lifecycle send points the
 * MUA at `POST /v1/unsubscribe?token=…`; with `List-Unsubscribe-Post:
 * List-Unsubscribe=One-Click` the MUA POSTs it WITHOUT a confirmation step, so
 * this endpoint must opt the user out from the token alone — no session. The
 * footer link humans click is the same URL via `GET`, which opts out and then
 * redirects to the storefront preference center.
 *
 * `@Public()` — no auth (the signed token IS the authorization). The token can
 * only flip one user+category email flag off, so its blast radius is bounded.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { Public, RateLimit } from '@common/decorators';
import { NotificationPreferenceService } from './notification-preference.service';
import { storefrontBaseUrl } from './config/public-hosts';
import { resolveLocale } from './listeners/locale.util';

function invalidToken(): never {
  throw new BadRequestException({
    error: {
      code: 'INVALID_UNSUBSCRIBE_TOKEN',
      message: 'The unsubscribe link is invalid or has expired.',
    },
  });
}

@ApiTags('notification-preferences')
@Controller('v1')
export class UnsubscribeController {
  constructor(
    private readonly preferences: NotificationPreferenceService,
    private readonly config: ConfigService,
  ) {}

  /**
   * RFC 8058 one-click. The MUA POSTs `List-Unsubscribe=One-Click` in the body;
   * the token rides on the query string (from the List-Unsubscribe header URL).
   */
  @Post('unsubscribe')
  /**
   * body-pluck-approved: unsubscribePost - RFC 8058 fixes the request body. A
   * mail user agent posts `List-Unsubscribe=One-Click` as form data and the
   * route reads the token out of it; a DTO class cannot be imposed on a body
   * the protocol defines. The token is the only field read and it is validated
   * by the opt-out lookup, which rejects anything that is not a live token.
   */
  @Public()
  @RateLimit.StorefrontWrite()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'One-click unsubscribe (RFC 8058)' })
  @ApiResponse({ status: 200, description: 'Opted out' })
  @ApiResponse({ status: 400, description: 'Invalid token' })
  async unsubscribePost(@Query('token') queryToken?: string, @Body('token') bodyToken?: string) {
    const result = await this.preferences.optOut(queryToken ?? bodyToken ?? '');
    if (!result) invalidToken();
    return { unsubscribed: true, category: result.category };
  }

  /** Human-clicked footer link — opt out, then redirect to the preference center. */
  @Get('unsubscribe')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'Unsubscribe via the email footer link' })
  @ApiResponse({ status: 302, description: 'Redirect to the preference center' })
  async unsubscribeGet(
    @Query('token') token: string,
    @Query('locale') localeParam: string,
    @Res() res: Response,
  ): Promise<void> {
    const base = storefrontBaseUrl(this.config);
    // The storefront is locale-prefixed (/fr|/en). Honour the locale that rode
    // on the link (the email's locale); an absent or unknown one resolves to
    // the store default rather than to a segment that would 404.
    const locale = resolveLocale(localeParam);
    const result = await this.preferences.optOut(token ?? '');
    const status = result ? encodeURIComponent(result.category) : 'invalid';
    res.redirect(302, `${base}/${locale}/account/preferences?unsubscribed=${status}`);
  }
}
