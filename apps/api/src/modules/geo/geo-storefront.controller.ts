import { Controller, Get, Header, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public, PublicCacheable, RateLimit } from '@common/decorators';
import { GeoService } from './geo.service';
import { storeLocales } from '@common/locale';
import { geoSupportedLocales } from './geo.constants';
import { resolvePublicBaseUrl } from '../seo/site-url';

/**
 * Public storefront GEO endpoint.
 *
 * GET /v1/llms.txt
 *   Returns a machine-readable Markdown file optimised for AI language models.
 *   Locale resolved from Accept-Language against the store's enabled set,
 *   falling back to the store default locale (runtime config, DR-31). Served
 *   from Redis cache with 6-hour TTL keyed per locale.
 *
 * Site URL is resolved via `resolvePublicBaseUrl` from
 * `STOREFRONT_PUBLIC_BASE_URL` (legacy `SITE_URL` accepted). The previous
 * request-host derivation produced `api.<domain>` URLs in the emitted
 * Markdown because the storefront edge proxy fetches the API at its own host.
 */
@ApiTags('geo')
@Controller('v1')
export class GeoStorefrontController {
  constructor(
    private readonly service: GeoService,
    private readonly config: ConfigService,
  ) {}

  @Get('llms.txt')
  @Public()
  @RateLimit.StorefrontRead()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @PublicCacheable(3600, 'Accept-Language')
  @ApiOperation({ summary: 'Serve the llms.txt file for AI language models' })
  async getLlmsTxt(@Req() req: Request, @Res() res: Response): Promise<void> {
    const locale = this.resolveLocale(req);
    const content = await this.service.getLlmsTxt(locale, resolvePublicBaseUrl(this.config));
    res.send(content);
  }

  /**
   * Comprehensive llms-full.txt — every active product with descriptions,
   * brand attribution, SKUs, prices; every visible category with its
   * description; full policy bodies. Per the llmstxt.org "expanded content"
   * convention, the canonical filename uses a hyphen (`llms-full.txt`); the
   * underscore variant is exposed via a separate storefront proxy alias.
   */
  @Get('llms-full.txt')
  @Public()
  @RateLimit.StorefrontRead()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @PublicCacheable(3600, 'Accept-Language')
  @ApiOperation({ summary: 'Serve the expanded llms-full.txt catalogue file' })
  async getLlmsFullTxt(@Req() req: Request, @Res() res: Response): Promise<void> {
    const locale = this.resolveLocale(req);
    const content = await this.service.getLlmsFullTxt(locale, resolvePublicBaseUrl(this.config));
    res.send(content);
  }

  private resolveLocale(req: Request): string {
    const acceptLang = (req.headers['accept-language'] ?? '').toLowerCase();
    return (
      geoSupportedLocales().find((l) => acceptLang.startsWith(l)) ??
      storeLocales.current().defaultLocale
    );
  }
}
