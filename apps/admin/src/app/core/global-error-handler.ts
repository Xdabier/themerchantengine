import { ErrorHandler, Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiError, ApiForbiddenError, ApiUnauthorizedError } from '@admin-types';
import { captureException } from './sentry';

/**
 * Angular global error handler. Catches both uncaught exceptions and HTTP
 * errors that bubble out of component code.
 *
 * Strategy:
 * - 401 (ApiUnauthorizedError): refreshInterceptor already handled the
 *   redirect; we just log.
 * - 403 (ApiForbiddenError): route to /403.
 * - 5xx (ApiError with status >= 500): route to /500 with correlation id
 *   and report to Sentry.
 * - Anything else: report to Sentry, log, and let Angular's default
 *   handler run.
 *
 * Sentry only fires when a DSN is configured (`environment.sentryDsn`);
 * `captureException` is a no-op otherwise.
 */
@Injectable({ providedIn: 'root' })
export class GlobalErrorHandler implements ErrorHandler {
  private readonly router = inject(Router);

  handleError(error: unknown): void {
    // Development-friendly logging — noisy in CI but invaluable in dev.
    // eslint-disable-next-line no-console
    console.error('[GlobalErrorHandler]', error);

    if (error instanceof ApiForbiddenError) {
      void this.router.navigate(['/403']);
      return;
    }

    if (error instanceof ApiUnauthorizedError) {
      // refreshInterceptor routes to /auth/login when refresh fails. If we hit
      // this branch, it's an unauthenticated call from guest context; do nothing.
      return;
    }

    if (error instanceof ApiError && error.status >= 500) {
      captureException(error);
      void this.router.navigate(['/500'], {
        queryParams: error.correlationId ? { correlationId: error.correlationId } : undefined,
      });
      return;
    }

    // Uncaught exceptions (not HTTP errors) — always report.
    captureException(error);
  }
}
