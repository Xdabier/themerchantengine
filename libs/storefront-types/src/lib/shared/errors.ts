import { apiErrorEnvelopeSchema, type ApiErrorEnvelope } from './envelope';

/**
 * Typed error class hierarchy used throughout the storefront. The transport
 * layer (`apps/storefront/src/server/api-client.ts` and the browser
 * `ApiClient` binding) maps every non-2xx response to one of these. The UI
 * never displays the raw backend message verbatim — it maps via this hierarchy
 * to brand-voiced copy through the storefront i18n stack.
 */

export interface StorefrontErrorInit {
  code: string;
  message: string;
  status: number;
  correlationId?: string | null;
  details?: unknown;
}

export class StorefrontError extends Error {
  readonly code: string;
  readonly status: number;
  readonly correlationId: string | null;
  readonly details: unknown;

  constructor(init: StorefrontErrorInit) {
    super(init.message);
    this.name = this.constructor.name;
    this.code = init.code;
    this.status = init.status;
    this.correlationId = init.correlationId ?? null;
    this.details = init.details;
  }
}

export class StorefrontValidationError extends StorefrontError {
  readonly fieldErrors: Record<string, string[]>;

  constructor(
    init: Omit<StorefrontErrorInit, 'status'> & {
      fieldErrors?: Record<string, string[]>;
    },
  ) {
    super({ ...init, status: 400 });
    this.fieldErrors = init.fieldErrors ?? {};
  }
}

export class StorefrontUnauthorizedError extends StorefrontError {
  constructor(init: Omit<StorefrontErrorInit, 'status'>) {
    super({ ...init, status: 401 });
  }
}

export class StorefrontForbiddenError extends StorefrontError {
  constructor(init: Omit<StorefrontErrorInit, 'status'>) {
    super({ ...init, status: 403 });
  }
}

export class StorefrontNotFoundError extends StorefrontError {
  constructor(init: Omit<StorefrontErrorInit, 'status'>) {
    super({ ...init, status: 404 });
  }
}

export class StorefrontConflictError extends StorefrontError {
  constructor(init: Omit<StorefrontErrorInit, 'status'>) {
    super({ ...init, status: 409 });
  }
}

export class StorefrontRateLimitError extends StorefrontError {
  readonly retryAfter: number | null;

  constructor(init: Omit<StorefrontErrorInit, 'status'> & { retryAfter?: number }) {
    super({ ...init, status: 429 });
    this.retryAfter = init.retryAfter ?? null;
  }
}

export class StorefrontServerError extends StorefrontError {
  constructor(init: Omit<StorefrontErrorInit, 'status'> & { status?: number }) {
    super({ ...init, status: init.status ?? 500 });
  }
}

export class StorefrontNetworkError extends StorefrontError {
  constructor(message = 'Network unreachable') {
    super({ code: 'NETWORK_ERROR', message, status: 0 });
  }
}

export interface MapHttpErrorArgs {
  status: number;
  body: unknown;
  correlationId?: string | null;
  retryAfterSeconds?: number | null;
}

/**
 * Convert a raw HTTP error response (status + envelope body + optional headers)
 * into the appropriate typed error class. Mirrors
 * `libs/admin-types/src/errors.ts:mapHttpErrorToApiError` field-for-field so
 * both clients agree on the mapping.
 */
export function mapHttpErrorToStorefrontError(args: MapHttpErrorArgs): StorefrontError {
  const { status, body, correlationId } = args;

  // Tripwire: HTTP 304 reaching this mapper means the upstream short-circuit
  // in `api-client.ts` / `browser-api-client.ts` is missing OR the API has
  // re-enabled ETag without setting `Cache-Control: no-store`. Both are
  // regressions of constitution §3.X-A / §3.X-B. Log loud so a developer
  // notices in the browser / SSR console; the `StorefrontErrorHandler`
  // (Sentry-wired) will pick up any throw downstream.
  if (status === 304) {
    console.error(
      '[storefront-types] HTTP 304 reached mapHttpErrorToStorefrontError — upstream short-circuit missing or API ETag re-enabled. See constitution §3.X-A.',
    );
  }

  const parsed = apiErrorEnvelopeSchema.safeParse(body);
  const envelope: ApiErrorEnvelope = parsed.success
    ? parsed.data
    : {
        error: {
          code: 'UNKNOWN',
          message: status === 0 ? 'Network unreachable' : 'Unexpected error',
        },
      };

  const init = {
    code: envelope.error.code,
    message: envelope.error.message,
    correlationId: correlationId ?? null,
    details: envelope.error.details,
  };

  if (status === 0) return new StorefrontNetworkError(init.message);
  if (status === 400) {
    const fieldErrors =
      typeof init.details === 'object' && init.details !== null && 'fieldErrors' in init.details
        ? (init.details as { fieldErrors?: Record<string, string[]> }).fieldErrors
        : undefined;
    return new StorefrontValidationError({ ...init, fieldErrors });
  }
  if (status === 401) return new StorefrontUnauthorizedError(init);
  if (status === 403) return new StorefrontForbiddenError(init);
  if (status === 404) return new StorefrontNotFoundError(init);
  if (status === 409) return new StorefrontConflictError(init);
  if (status === 429)
    return new StorefrontRateLimitError({
      ...init,
      retryAfter: args.retryAfterSeconds ?? undefined,
    });
  if (status >= 500) return new StorefrontServerError({ ...init, status });

  return new StorefrontError({ ...init, status });
}
