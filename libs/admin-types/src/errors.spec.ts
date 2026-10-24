import {
  ApiError,
  ApiForbiddenError,
  ApiNetworkError,
  ApiNotFoundError,
  ApiRateLimitError,
  ApiServerError,
  ApiUnauthorizedError,
  ApiValidationError,
  mapHttpErrorToApiError,
} from './errors';

describe('mapHttpErrorToApiError', () => {
  const envelope = (code: string, message: string, details?: unknown) => ({
    error: { code, message, details },
  });

  it('maps 400 to ApiValidationError and pulls fieldErrors from details', () => {
    const err = mapHttpErrorToApiError({
      status: 400,
      body: envelope('VALIDATION_FAILED', 'Invalid', { fieldErrors: { email: ['required'] } }),
      correlationId: 'req-1',
    });
    expect(err).toBeInstanceOf(ApiValidationError);
    expect((err as ApiValidationError).fieldErrors).toEqual({ email: ['required'] });
    expect(err.correlationId).toBe('req-1');
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_FAILED');
  });

  it('maps 401 to ApiUnauthorizedError', () => {
    const err = mapHttpErrorToApiError({
      status: 401,
      body: envelope('UNAUTHORIZED', 'Token expired'),
    });
    expect(err).toBeInstanceOf(ApiUnauthorizedError);
    expect(err.status).toBe(401);
  });

  it('maps 403 to ApiForbiddenError', () => {
    const err = mapHttpErrorToApiError({
      status: 403,
      body: envelope('FORBIDDEN', 'Missing permission'),
    });
    expect(err).toBeInstanceOf(ApiForbiddenError);
    expect(err.status).toBe(403);
  });

  it('maps 404 to ApiNotFoundError', () => {
    const err = mapHttpErrorToApiError({
      status: 404,
      body: envelope('NOT_FOUND', 'Missing resource'),
    });
    expect(err).toBeInstanceOf(ApiNotFoundError);
  });

  it('maps 429 to ApiRateLimitError and carries retry-after', () => {
    const err = mapHttpErrorToApiError({
      status: 429,
      body: envelope('RATE_LIMITED', 'Too many requests'),
      retryAfterSeconds: 30,
    });
    expect(err).toBeInstanceOf(ApiRateLimitError);
    expect((err as ApiRateLimitError).retryAfter).toBe(30);
  });

  it('maps 500 to ApiServerError and retains the actual status', () => {
    const err = mapHttpErrorToApiError({
      status: 502,
      body: envelope('BAD_GATEWAY', 'Upstream failed'),
    });
    expect(err).toBeInstanceOf(ApiServerError);
    expect(err.status).toBe(502);
  });

  it('maps 0 to ApiNetworkError', () => {
    const err = mapHttpErrorToApiError({ status: 0, body: null });
    expect(err).toBeInstanceOf(ApiNetworkError);
    expect(err.code).toBe('NETWORK_ERROR');
  });

  it('synthesizes a generic error when the envelope is malformed', () => {
    const err = mapHttpErrorToApiError({
      status: 418,
      body: { unexpected: 'shape' },
    });
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('UNKNOWN');
    expect(err.status).toBe(418);
  });
});
