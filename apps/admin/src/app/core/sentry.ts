import { environment } from '../../environments/environment';

/**
 * Sentry is dynamic-imported so the SDK only lands in the bundle when a
 * DSN is actually configured. In dev / on PR previews where `sentryDsn` is
 * null, the import never fires and the main chunk stays tiny — critical
 * for the main-bundle budget (80 kB error ceiling).
 */

type SentryModule = typeof import('@sentry/angular');
let sentryPromise: Promise<SentryModule> | null = null;

export function initSentry(): void {
  const dsn = environment.sentryDsn;
  if (!dsn) return;

  sentryPromise = import('@sentry/angular').then((Sentry) => {
    Sentry.init({
      dsn,
      environment: environment.production ? 'production' : 'development',
      tracesSampleRate: environment.production ? 0.1 : 1.0,
      // Per spec §10 — never send PII. Scrub headers + cookies client-side
      // before the SDK ships the event.
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.request?.headers) delete event.request.headers;
        if (event.request?.cookies) delete event.request.cookies;
        return event;
      },
    });
    return Sentry;
  });
}

/**
 * Report an error to Sentry. Safe to call regardless of whether a DSN was
 * configured — when Sentry never loaded, the call silently no-ops.
 */
export function captureException(error: unknown): void {
  if (!sentryPromise) return;
  void sentryPromise.then((Sentry) => Sentry.captureException(error));
}
