import { BadRequestException } from '@nestjs/common';

/**
 * URL-Inspection (DR-17 D5) request-shape exceptions. Stable error codes the
 * `HttpExceptionFilter` forwards verbatim via its pre-formatted-envelope branch.
 * The "exactly one of url | productId" rule is enforced in the service rather than
 * via class-validator because the check must run even when both target fields are
 * absent — a case `@IsOptional` would skip (mirrors the D2 submit orchestrator).
 */

export class SeoNoInspectTargetException extends BadRequestException {
  static readonly CODE = 'SEO_NO_INSPECT_TARGET' as const;

  constructor() {
    super({
      error: {
        code: SeoNoInspectTargetException.CODE,
        message: 'An inspection target is required: one of url or productId.',
      },
    });
  }
}

export class SeoMultipleInspectTargetsException extends BadRequestException {
  static readonly CODE = 'SEO_MULTIPLE_INSPECT_TARGETS' as const;

  constructor() {
    super({
      error: {
        code: SeoMultipleInspectTargetsException.CODE,
        message: 'Provide exactly one inspection target: url or productId — not both.',
      },
    });
  }
}
