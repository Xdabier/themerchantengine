import { apiErrorEnvelopeSchema, type ApiErrorEnvelope } from './envelope';

/**
 * Typed error class hierarchy used throughout the admin frontend.
 * Every HTTP error coming out of the interceptor chain is mapped to one of
 * these. Never surface the raw backend message to the user — map via this
 * hierarchy to the appropriate toast copy.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly correlationId: string | null;
  readonly details: unknown;

  constructor(init: {
    code: string;
    message: string;
    status: number;
    correlationId?: string | null;
    details?: unknown;
  }) {
    super(init.message);
    this.name = this.constructor.name;
    this.code = init.code;
    this.status = init.status;
    this.correlationId = init.correlationId ?? null;
    this.details = init.details;
  }
}

export class ApiValidationError extends ApiError {
  readonly fieldErrors: Record<string, string[]>;

  constructor(init: {
    code: string;
    message: string;
    correlationId?: string | null;
    details?: unknown;
    fieldErrors?: Record<string, string[]>;
  }) {
    super({ ...init, status: 400 });
    this.fieldErrors = init.fieldErrors ?? {};
  }
}

export class ApiUnauthorizedError extends ApiError {
  constructor(init: Omit<ConstructorParameters<typeof ApiError>[0], 'status'>) {
    super({ ...init, status: 401 });
  }
}

export class ApiForbiddenError extends ApiError {
  readonly requiredPermission: string | null;
  constructor(
    init: Omit<ConstructorParameters<typeof ApiError>[0], 'status'> & {
      requiredPermission?: string;
    },
  ) {
    super({ ...init, status: 403 });
    this.requiredPermission = init.requiredPermission ?? null;
  }
}

export class ApiNotFoundError extends ApiError {
  constructor(init: Omit<ConstructorParameters<typeof ApiError>[0], 'status'>) {
    super({ ...init, status: 404 });
  }
}

export class ApiConflictError extends ApiError {
  constructor(init: Omit<ConstructorParameters<typeof ApiError>[0], 'status'>) {
    super({ ...init, status: 409 });
  }
}

export class ApiRateLimitError extends ApiError {
  readonly retryAfter: number | null;

  constructor(
    init: Omit<ConstructorParameters<typeof ApiError>[0], 'status'> & {
      retryAfter?: number;
    },
  ) {
    super({ ...init, status: 429 });
    this.retryAfter = init.retryAfter ?? null;
  }
}

export class ApiServerError extends ApiError {
  constructor(
    init: Omit<ConstructorParameters<typeof ApiError>[0], 'status'> & {
      status?: number;
    },
  ) {
    super({ ...init, status: init.status ?? 500 });
  }
}

export class ApiNetworkError extends ApiError {
  constructor(message = 'Network unreachable') {
    super({ code: 'NETWORK_ERROR', message, status: 0 });
  }
}

/**
 * Parse a raw HTTP error response (the backend envelope + the HTTP status code)
 * into the appropriate typed error class.
 */
export function mapHttpErrorToApiError(args: {
  status: number;
  body: unknown;
  correlationId?: string | null;
  retryAfterSeconds?: number | null;
}): ApiError {
  const { status, body, correlationId } = args;

  // Tripwire: HTTP 304 reaching this mapper means the upstream short-circuit
  // in `error-normalizer.interceptor.ts` is missing OR the API has
  // re-enabled ETag without setting `Cache-Control: no-store`. Both are
  // regressions of constitution §3.X-A / §3.X-B. Log loud so a developer
  // notices in the browser console; the framework `ErrorHandler` (Sentry-
  // wired) will pick up the throw downstream if a caller propagates it.
  if (status === 304) {
    console.error(
      '[admin-types] HTTP 304 reached mapHttpErrorToApiError — upstream short-circuit missing or API ETag re-enabled. See constitution §3.X-A.',
    );
  }

  // Try to parse the envelope. If it doesn't match, synthesize a generic error.
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

  if (status === 0) return new ApiNetworkError(init.message);
  if (status === 400) {
    const fieldErrors =
      typeof init.details === 'object' && init.details !== null && 'fieldErrors' in init.details
        ? (init.details as { fieldErrors?: Record<string, string[]> }).fieldErrors
        : undefined;
    return new ApiValidationError({ ...init, fieldErrors });
  }
  if (status === 401) return new ApiUnauthorizedError(init);
  if (status === 403) return new ApiForbiddenError(init);
  if (status === 404) return new ApiNotFoundError(init);
  if (status === 409) return new ApiConflictError(init);
  if (status === 429)
    return new ApiRateLimitError({ ...init, retryAfter: args.retryAfterSeconds ?? undefined });
  if (status >= 500) return new ApiServerError({ ...init, status });

  return new ApiError({ ...init, status });
}
