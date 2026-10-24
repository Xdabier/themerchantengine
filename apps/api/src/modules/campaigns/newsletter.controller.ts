/**
 * Public newsletter endpoints (NE9) — storefront signup + double opt-in confirm
 * + subscriber one-click/footer unsubscribe. All `@Public()` (no session): the
 * signed token is the authorization for confirm/unsubscribe; signup is open.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { Public, RateLimit } from '@common/decorators';
import { BotProtected } from '../../common/bot-protection';
import { SubscriberService } from './subscriber.service';
import { SubscribeDto } from './dto/subscriber.dto';
import { storefrontBaseUrl } from '../mail/config/public-hosts';
import { resolveLocale } from '../mail/listeners/locale.util';

@ApiTags('newsletter')
@Controller('v1/newsletter')
export class NewsletterController {
  constructor(
    private readonly subscribers: SubscriberService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Newsletter signup. Always returns a neutral 202 (enumeration-safe): the
   * caller cannot tell whether the address was new, pending, or already
   * confirmed. A confirmation email is (re)sent for new / pending addresses.
   */
  @Post('subscribe')
  @Public()
  @BotProtected()
  @RateLimit.StorefrontWrite()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Subscribe to the newsletter (double opt-in)' })
  @ApiResponse({ status: 202, description: 'Confirmation email sent if applicable' })
  @ApiResponse({ status: 400, description: 'Invalid email' })
  async subscribe(@Body() dto: SubscribeDto): Promise<{ status: string }> {
    await this.subscribers.subscribe(dto.email, resolveLocale(dto.locale), 'newsletter-footer');
    // The global response interceptor wraps this in { data: ... }.
    return { status: 'ok' };
  }

  /** Double opt-in confirmation (footer link) — set confirmedAt, then redirect. */
  @Get('confirm')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'Confirm a newsletter subscription' })
  @ApiResponse({ status: 302, description: 'Redirect to the storefront confirmation page' })
  async confirm(
    @Query('token') token: string,
    @Query('locale') localeParam: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.subscribers.confirm(token ?? '');
    const status = result.confirmed ? 'confirmed' : 'invalid';
    res.redirect(302, this.storefrontUrl(localeParam, status));
  }

  /** RFC 8058 one-click unsubscribe (MUA POST) — opt out from the token alone. */
  /**
   * body-pluck-approved: unsubscribePost - RFC 8058 fixes the request body. A
   * mail user agent posts `List-Unsubscribe=One-Click` as form data and the
   * route reads the token out of it; a DTO class cannot be imposed on a body
   * the protocol defines. The token is the only field read and it is validated
   * by the opt-out lookup, which rejects anything that is not a live token.
   */
  @Post('unsubscribe')
  @Public()
  @RateLimit.StorefrontWrite()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'One-click newsletter unsubscribe (RFC 8058)' })
  @ApiResponse({ status: 200, description: 'Opted out' })
  async unsubscribePost(
    @Query('token') queryToken?: string,
    @Body('token') bodyToken?: string,
  ): Promise<{ unsubscribed: boolean }> {
    const result = await this.subscribers.unsubscribeByToken(queryToken ?? bodyToken ?? '');
    return { unsubscribed: result.ok };
  }

  /** Human-clicked footer unsubscribe link — opt out, then redirect. */
  @Get('unsubscribe')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'Unsubscribe via the email footer link' })
  @ApiResponse({ status: 302, description: 'Redirect to the storefront confirmation page' })
  async unsubscribeGet(
    @Query('token') token: string,
    @Query('locale') localeParam: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.subscribers.unsubscribeByToken(token ?? '');
    const status = result.ok ? 'unsubscribed' : 'invalid';
    res.redirect(302, this.storefrontUrl(localeParam, status));
  }

  /** Locale-prefixed storefront confirmation page (one page handles all states). */
  private storefrontUrl(localeParam: string, status: string): string {
    const base = storefrontBaseUrl(this.config);
    const locale = resolveLocale(localeParam);
    return `${base}/${locale}/newsletter/confirm?status=${encodeURIComponent(status)}`;
  }
}
