import { describe, expect, it } from 'vitest';
import {
  StorefrontConflictError,
  StorefrontError,
  StorefrontForbiddenError,
  StorefrontNetworkError,
  StorefrontNotFoundError,
  StorefrontRateLimitError,
  StorefrontServerError,
  StorefrontUnauthorizedError,
  StorefrontValidationError,
  mapHttpErrorToStorefrontError,
} from './errors';

const envelope = (code: string, message: string, details?: unknown) => ({
  error: { code, message, ...(details !== undefined ? { details } : {}) },
});

describe('mapHttpErrorToStorefrontError', () => {
  it('maps status 0 to network error', () => {
    const err = mapHttpErrorToStorefrontError({ status: 0, body: null });
    expect(err).toBeInstanceOf(StorefrontNetworkError);
    expect(err.code).toBe('NETWORK_ERROR');
  });

  it('maps 400 with fieldErrors detail to validation error', () => {
    const err = mapHttpErrorToStorefrontError({
      status: 400,
      body: envelope('VALIDATION', 'Invalid', { fieldErrors: { email: ['required'] } }),
    });
    expect(err).toBeInstanceOf(StorefrontValidationError);
    expect((err as StorefrontValidationError).fieldErrors.email).toEqual(['required']);
  });

  it('maps 400 without fieldErrors detail to validation error with empty map', () => {
    const err = mapHttpErrorToStorefrontError({
      status: 400,
      body: envelope('VALIDATION', 'Invalid'),
    });
    expect(err).toBeInstanceOf(StorefrontValidationError);
    expect((err as StorefrontValidationError).fieldErrors).toEqual({});
  });

  it('maps 401 to unauthorized', () => {
    const err = mapHttpErrorToStorefrontError({
      status: 401,
      body: envelope('AUTH', 'Login required'),
    });
    expect(err).toBeInstanceOf(StorefrontUnauthorizedError);
  });

  it('maps 403 to forbidden', () => {
    const err = mapHttpErrorToStorefrontError({ status: 403, body: envelope('FORBIDDEN', 'No') });
    expect(err).toBeInstanceOf(StorefrontForbiddenError);
  });

  it('maps 404 to not-found', () => {
    const err = mapHttpErrorToStorefrontError({
      status: 404,
      body: envelope('NOT_FOUND', 'Missing'),
    });
    expect(err).toBeInstanceOf(StorefrontNotFoundError);
  });

  it('maps 409 to conflict', () => {
    const err = mapHttpErrorToStorefrontError({ status: 409, body: envelope('CONFLICT', 'Dup') });
    expect(err).toBeInstanceOf(StorefrontConflictError);
  });

  it('maps 429 with retry-after to rate-limit', () => {
    const err = mapHttpErrorToStorefrontError({
      status: 429,
      body: envelope('RATE_LIMIT', 'Slow down'),
      retryAfterSeconds: 30,
    });
    expect(err).toBeInstanceOf(StorefrontRateLimitError);
    expect((err as StorefrontRateLimitError).retryAfter).toBe(30);
  });

  it('maps 500 to server error', () => {
    const err = mapHttpErrorToStorefrontError({ status: 500, body: envelope('INTERNAL', 'Oops') });
    expect(err).toBeInstanceOf(StorefrontServerError);
    expect(err.status).toBe(500);
  });

  it('maps 503 to server error with status passthrough', () => {
    const err = mapHttpErrorToStorefrontError({ status: 503, body: envelope('UPSTREAM', 'Down') });
    expect(err).toBeInstanceOf(StorefrontServerError);
    expect(err.status).toBe(503);
  });

  it('falls back to generic StorefrontError for unmapped status', () => {
    const err = mapHttpErrorToStorefrontError({ status: 418, body: envelope('TEAPOT', 'Short') });
    expect(err.constructor).toBe(StorefrontError);
    expect(err.status).toBe(418);
  });

  it('synthesizes envelope when body shape mismatches', () => {
    const err = mapHttpErrorToStorefrontError({ status: 500, body: 'totally-broken' });
    expect(err.code).toBe('UNKNOWN');
  });

  it('threads correlationId through', () => {
    const err = mapHttpErrorToStorefrontError({
      status: 404,
      body: envelope('NOT_FOUND', 'Missing'),
      correlationId: 'req-123',
    });
    expect(err.correlationId).toBe('req-123');
  });
});
