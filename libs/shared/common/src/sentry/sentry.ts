import * as Sentry from '@sentry/node';

/**
 * Initialise Sentry for the NestJS process. No-op when `SENTRY_DSN` is
 * absent — production must set it; dev may omit it and the SDK stays
 * uninitialised so `captureException` is a cheap no-op.
 *
 * Per spec §10: never send PII. Cookies + headers are scrubbed via
 * `beforeSend` before the event leaves the process.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.headers;
        delete event.request.cookies;
        delete event.request.data;
      }
      return event;
    },
  });
}

/**
 * Report an error to Sentry. Safe to call regardless of whether
 * `initSentry` ran — the SDK no-ops when uninitialised.
 */
export function captureException(error: unknown): void {
  Sentry.captureException(error);
}
