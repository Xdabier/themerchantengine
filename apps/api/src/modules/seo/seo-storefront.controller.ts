import { Controller, Get, Header, Inject, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public, PublicCacheable, RateLimit } from '@common/decorators';
import { SettingsService } from '../settings/settings.service';
import { SeoService } from './seo.service';
import { SEO_SETTINGS_SERVICE } from './seo.constants';
import { resolvePublicBaseUrl } from './site-url';

/**
 * Public storefront SEO endpoints — no authentication required.
 *
 * GET /v1/sitemap_index.xml   → sitemap index (served from Redis cache)
 * GET /v1/sitemap.xml         → alias: redirects to sitemap_index.xml
 * GET /v1/sitemap-products.xml
 * GET /v1/sitemap-categories.xml
 * GET /v1/sitemap-pages.xml
 * GET /v1/robots.txt
 *
 * Site URL is resolved via `resolvePublicBaseUrl` from
 * `STOREFRONT_PUBLIC_BASE_URL` (with `SITE_URL` legacy fallback). The previous
 * `${req.protocol}://${req.get('host')}` derivation produced `api.<domain>`
 * URLs because the storefront edge proxy fetches the API at its own host —
 * crawlers then saw cross-origin `Sitemap:` directives and `<loc>` entries.
 */
@ApiTags('seo')
@Controller('v1')
export class SeoStorefrontController {
  constructor(
    private readonly service: SeoService,
    private readonly config: ConfigService,
    @Inject(SEO_SETTINGS_SERVICE)
    private readonly settings: SettingsService,
  ) {}

  /**
   * Every active redirect, for the storefront edge to resolve against.
   *
   * Public because a redirect is public by construction: anyone can observe one
   * by requesting the old URL. Nothing here is not already discoverable.
   *
   * It exists because `SeoRedirectMiddleware` is mounted on THIS process, while
   * every row it holds is a STOREFRONT path (`/{locale}/catalog/product/{slug}`,
   * minted by the seed pipeline). nginx routes `/v1/` here and everything else
   * to the storefront's Nitro server, so a request for a `fromPath` never
   * reached the middleware and every row was inert. Verified on production
   * 2026-09-02: an old URL answered 200 instead of redirecting.
   *
   * The whole set is returned rather than a per-path lookup so the edge caches
   * it once and costs nothing per request. The table is small by nature: one
   * row per moved URL per locale.
   */
  @Get('seo/redirects')
  @Public()
  @RateLimit.StorefrontRead()
  @PublicCacheable(300)
  @ApiOperation({ summary: 'List all active SEO redirects for the storefront edge' })
  async listActiveRedirects(): Promise<{ fromPath: string; toPath: string; permanent: boolean }[]> {
    // Returns the bare array. The global response interceptor wraps every
    // payload in `{ data }`, so returning `{ data }` here produced
    // `{"data":{"data":[...]}}` and the edge silently read nothing.
    return this.service.listActiveRedirects();
  }

  @Get('sitemap_index.xml')
  @Public()
  @RateLimit.StorefrontRead()
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @PublicCacheable(3600)
  @ApiOperation({ summary: 'Serve the sitemap index XML' })
  async getSitemapIndex(@Res() res: Response): Promise<void> {
    const xml = await this.service.getSitemapIndex(resolvePublicBaseUrl(this.config));
    res.send(xml);
  }

  /** Alias: /sitemap.xml → 301 to /sitemap_index.xml */
  @Get('sitemap.xml')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'Redirect sitemap.xml to the sitemap index' })
  getSitemapAlias(@Res() res: Response): void {
    res.redirect(301, '/v1/sitemap_index.xml');
  }

  @Get('sitemap-products.xml')
  @Public()
  @RateLimit.StorefrontRead()
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @PublicCacheable(3600)
  @ApiOperation({ summary: 'Serve the products sitemap XML' })
  async getProductsSitemap(@Res() res: Response): Promise<void> {
    const xml = await this.service.getProductsSitemap(resolvePublicBaseUrl(this.config));
    res.send(xml);
  }

  @Get('sitemap-categories.xml')
  @Public()
  @RateLimit.StorefrontRead()
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @PublicCacheable(3600)
  @ApiOperation({ summary: 'Serve the categories sitemap XML' })
  async getCategoriesSitemap(@Res() res: Response): Promise<void> {
    const xml = await this.service.getCategoriesSitemap(resolvePublicBaseUrl(this.config));
    res.send(xml);
  }

  @Get('sitemap-pages.xml')
  @Public()
  @RateLimit.StorefrontRead()
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @PublicCacheable(3600)
  @ApiOperation({ summary: 'Serve the CMS pages sitemap XML' })
  async getPagesSitemap(@Res() res: Response): Promise<void> {
    const xml = await this.service.getPagesSitemap(resolvePublicBaseUrl(this.config));
    res.send(xml);
  }

  @Get('robots.txt')
  @Public()
  @RateLimit.StorefrontRead()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @PublicCacheable(3600)
  @ApiOperation({ summary: 'Serve the robots.txt file' })
  async getRobotsTxt(@Res() res: Response): Promise<void> {
    const content = await this.service.getRobotsTxt(resolvePublicBaseUrl(this.config));
    res.send(content);
  }
}
