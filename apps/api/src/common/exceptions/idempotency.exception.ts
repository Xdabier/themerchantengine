import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

/**
 * Idempotency-contract exceptions (§9.5 I1 + `specs/features/full-stack-audit-2026-05-14/plan.md` §1.12).
 *
 * Stable error codes the `HttpExceptionFilter` forwards verbatim via the
 * pre-formatted-envelope branch at `libs/shared/common/src/filters/http-exception.filter.ts:117-141`.
 */

export class IdempotencyKeyRequiredException extends BadRequestException {
  static readonly CODE = 'IDEMPOTENCY_KEY_REQUIRED' as const;

  constructor() {
    super({
      error: {
        code: IdempotencyKeyRequiredException.CODE,
        message: 'X-Idempotency-Key header is required for this endpoint.',
      },
    });
  }
}

export class IdempotencyKeyMalformedException extends BadRequestException {
  static readonly CODE = 'IDEMPOTENCY_KEY_MALFORMED' as const;

  constructor() {
    super({
      error: {
        code: IdempotencyKeyMalformedException.CODE,
        message: 'X-Idempotency-Key must be a UUID v4 string.',
      },
    });
  }
}

/**
 * Same key + same caller + different body — original payload is locked in
 * for the TTL window; the retry's body diverges, so the cached response is
 * not safe to return.
 */
export class IdempotencyKeyConflictException extends ConflictException {
  static readonly CODE = 'IDEMPOTENCY_KEY_CONFLICT' as const;

  constructor() {
    super({
      error: {
        code: IdempotencyKeyConflictException.CODE,
        message: 'X-Idempotency-Key was previously used with a different request body.',
      },
    });
  }
}

/**
 * Same key + different caller — possible cross-tenant probe. Constitution
 * §3.6 binds the cache entry to the caller hash; a mismatch is a 403, not
 * a 409 (an attacker should not learn the body-equality bit either).
 */
export class IdempotencyKeyForbiddenException extends ForbiddenException {
  static readonly CODE = 'IDEMPOTENCY_KEY_FORBIDDEN' as const;

  constructor() {
    super({
      error: {
        code: IdempotencyKeyForbiddenException.CODE,
        message: 'X-Idempotency-Key was previously used by another caller.',
      },
    });
  }
}
