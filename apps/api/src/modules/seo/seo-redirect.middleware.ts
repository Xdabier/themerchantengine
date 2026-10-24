import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RedirectType } from '@prisma/client';
import { SeoService } from './seo.service';

/**
 * Checks every incoming request path against the SeoRedirect table.
 * Issues a 301 or 302 if a matching redirect is found.
 *
 * Applied globally in SeoModule via configure().
 */
@Injectable()
export class SeoRedirectMiddleware implements NestMiddleware {
  constructor(private readonly seoService: SeoService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const fromPath = req.path;

    // Skip non-page paths (API, assets, health) to avoid unnecessary DB lookups
    if (
      fromPath.startsWith('/v1/') ||
      fromPath.startsWith('/health') ||
      fromPath.startsWith('/favicon')
    ) {
      next();
      return;
    }

    try {
      const redirect = await this.seoService.resolveRedirect(fromPath);
      if (redirect) {
        const statusCode = redirect.type === RedirectType.MOVED_PERMANENTLY ? 301 : 302;
        res.redirect(statusCode, redirect.toPath);
        return;
      }
    } catch {
      // Never block a request due to redirect lookup failure
    }

    next();
  }
}
