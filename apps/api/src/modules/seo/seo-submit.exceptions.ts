import { BadRequestException } from '@nestjs/common';

/**
 * Manual reindex submit (DR-17 D2) request-shape exceptions. Stable error codes
 * the `HttpExceptionFilter` forwards verbatim via its pre-formatted-envelope
 * branch. The target rule ("exactly one of url / productIds / sitemap") is
 * enforced in the orchestrator rather than via class-validator because the
 * check must run even when every target field is absent — a case `@IsOptional`
 * would skip.
 */

export class SeoNoTargetException extends BadRequestException {
  static readonly CODE = 'SEO_NO_TARGET' as const;

  constructor() {
    super({
      error: {
        code: SeoNoTargetException.CODE,
        message: 'A submit target is required: one of url, productIds, or sitemap.',
      },
    });
  }
}

export class SeoMultipleTargetsException extends BadRequestException {
  static readonly CODE = 'SEO_MULTIPLE_TARGETS' as const;

  constructor() {
    super({
      error: {
        code: SeoMultipleTargetsException.CODE,
        message: 'Provide exactly one submit target: url, productIds, or sitemap — not several.',
      },
    });
  }
}

/**
 * The requested `engines` set, narrowed to the engines applicable to the target
 * type, is empty (e.g. `engines:['gsc']` on a single-url target — GSC indexes
 * sitemaps, not individual URLs). Rejected loudly rather than recording a
 * misleading "disabled" audit row the operator never meaningfully requested.
 */
export class SeoNoApplicableEngineException extends BadRequestException {
  static readonly CODE = 'SEO_NO_APPLICABLE_ENGINE' as const;

  constructor() {
    super({
      error: {
        code: SeoNoApplicableEngineException.CODE,
        message: 'None of the requested engines can be submitted to for this target type.',
      },
    });
  }
}

/**
 * A url-target whose origin is not the configured public storefront base.
 * IndexNow advertises a single `host` and rejects cross-host URLs, so a foreign
 * URL would waste the whole batch; reject it up front with a clear code.
 */
export class SeoForeignUrlException extends BadRequestException {
  static readonly CODE = 'SEO_FOREIGN_URL' as const;

  constructor() {
    super({
      error: {
        code: SeoForeignUrlException.CODE,
        message: 'url must be on the public storefront origin.',
      },
    });
  }
}
