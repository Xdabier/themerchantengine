import {
  HttpClient,
  HttpResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ApiForbiddenError,
  ApiNetworkError,
  ApiNotFoundError,
  ApiRateLimitError,
  ApiValidationError,
} from '@admin-types';
import { errorNormalizerInterceptor } from './error-normalizer.interceptor';

describe('errorNormalizerInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorNormalizerInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  const flushError = (
    url: string,
    body: unknown,
    status: number,
    statusText: string,
    headers?: Record<string, string>,
  ) => {
    httpMock.expectOne(url).flush(body, { status, statusText, headers });
  };

  it('maps 400 to ApiValidationError', (done) => {
    http.get('/api/invalid').subscribe({
      error: (err) => {
        expect(err).toBeInstanceOf(ApiValidationError);
        expect(err.fieldErrors).toEqual({ email: ['required'] });
        done();
      },
    });
    flushError(
      '/api/invalid',
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'invalid',
          details: { fieldErrors: { email: ['required'] } },
        },
      },
      400,
      'Bad Request',
    );
  });

  it('maps 403 to ApiForbiddenError and carries correlation id', (done) => {
    http.get('/api/forbidden', { headers: { 'X-Request-Id': 'req-42' } }).subscribe({
      error: (err) => {
        expect(err).toBeInstanceOf(ApiForbiddenError);
        expect(err.correlationId).toBe('req-42');
        done();
      },
    });
    flushError(
      '/api/forbidden',
      { error: { code: 'FORBIDDEN', message: 'nope' } },
      403,
      'Forbidden',
    );
  });

  it('maps 404 to ApiNotFoundError', (done) => {
    http.get('/api/missing').subscribe({
      error: (err) => {
        expect(err).toBeInstanceOf(ApiNotFoundError);
        done();
      },
    });
    flushError('/api/missing', { error: { code: 'NOT_FOUND', message: 'gone' } }, 404, 'Not Found');
  });

  it('maps 429 to ApiRateLimitError with Retry-After header parsed', (done) => {
    http.get('/api/rate').subscribe({
      error: (err) => {
        expect(err).toBeInstanceOf(ApiRateLimitError);
        expect(err.retryAfter).toBe(60);
        done();
      },
    });
    flushError(
      '/api/rate',
      { error: { code: 'RATE_LIMITED', message: 'slow down' } },
      429,
      'Too Many',
      { 'Retry-After': '60' },
    );
  });

  it('maps status 0 (network failure) to ApiNetworkError', (done) => {
    http.get('/api/offline').subscribe({
      error: (err) => {
        expect(err).toBeInstanceOf(ApiNetworkError);
        done();
      },
    });
    httpMock
      .expectOne('/api/offline')
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown' });
  });

  // Constitution §3.X-B: HTTP 304 is success in HTTP semantics (the cached
  // value is still valid) but Angular HttpClient routes status >= 300 to the
  // error stream. The 2026-05-16 incident root-caused the "Could not load X.
  // Please retry." cascade and the admin auth-stick regression to a 304 on
  // /v1/users/me being mapped to a generic UNKNOWN error. The interceptor
  // must short-circuit 304 to a synthetic success so TanStack Query observers
  // retain their cached value.
  it('short-circuits a 304 Not Modified to a synthetic HttpResponse instead of throwing', (done) => {
    http.get('/api/users/me', { observe: 'response' }).subscribe({
      next: (response) => {
        expect(response).toBeInstanceOf(HttpResponse);
        expect(response.status).toBe(304);
        expect(response.body).toBeNull();
        done();
      },
      error: (err) => done.fail(`Should not error on 304, got: ${String(err)}`),
    });
    flushError('/api/users/me', null, 304, 'Not Modified');
  });
});
