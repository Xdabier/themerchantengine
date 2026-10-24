import { getRequestHeader, setResponseHeader, setResponseStatus, type H3Event } from 'h3';

import { readStoreConfig } from './store-config';

/**
 * Shared proxy helper for the storefront's SEO + GEO surfaces (sitemap*,
 * robots.txt, llms.txt). Each route delegates to `proxyTextSurface` with
 * the upstream path, the content-type to set on the storefront response,
 * and the cache-control directive. The helper:
 *
 * - Resolves the API base URL from `STOREFRONT_API_URL` (defaults to
 *   `http://localhost:53000/api` — same default as
 *   `apps/storefront/src/server/api-client.ts`).
 * - Sends the store's default locale as `Accept-Language` upstream (read from
 *   the runtime store config; the proxied SEO surfaces are locale-agnostic at
 *   the storefront edge).
 * - Generates a fresh `X-Request-Id` for log correlation
 *   (constitution §3.7).
 * - Sets the storefront response content-type + cache-control headers and
 *   returns the upstream body byte-for-byte unmodified.
 * - On upstream non-2xx, surfaces a 502 with a minimal text body and an
 *   `X-Request-Id` echo so log correlation survives the failure.
 */

export interface ProxyTextSurfaceOptions {
  upstreamPath: string;
  contentType: string;
  cacheControl: string;
  fetchImpl?: typeof fetch;
  /**
   * When true, forwards the inbound `Accept-Language` header upstream instead
   * of forcing the store default locale. Used for locale-aware surfaces (llms.txt) so
   * that `curl -H 'Accept-Language: en'` retrieves the English variant.
   * Sitemap and robots.txt are locale-agnostic and leave this flag false.
   */
  forwardAcceptLanguage?: boolean;
}

const DEFAULT_API_BASE = 'http://localhost:53000/api';

function resolveApiBase(): string {
  const raw = process.env['STOREFRONT_API_URL'] ?? DEFAULT_API_BASE;
  return raw.replace(/\/$/, '');
}

function generateRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `req-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

export async function proxyTextSurface(
  event: H3Event,
  opts: ProxyTextSurfaceOptions,
): Promise<string> {
  const requestId = generateRequestId();
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = `${resolveApiBase()}${opts.upstreamPath}`;
  const { localization } = await readStoreConfig();
  const acceptLanguage = opts.forwardAcceptLanguage
    ? (getRequestHeader(event, 'accept-language') ?? localization.defaultLocale)
    : localization.defaultLocale;

  let upstream: Response;
  try {
    upstream = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: opts.contentType,
        'Accept-Language': acceptLanguage,
        'X-Request-Id': requestId,
      },
    });
  } catch {
    setResponseStatus(event, 502);
    setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8');
    setResponseHeader(event, 'X-Request-Id', requestId);
    return 'Upstream unreachable';
  }

  if (!upstream.ok) {
    setResponseStatus(event, 502);
    setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8');
    setResponseHeader(event, 'X-Request-Id', requestId);
    return `Upstream responded ${upstream.status}`;
  }

  const body = await upstream.text();
  setResponseStatus(event, 200);
  setResponseHeader(event, 'Content-Type', opts.contentType);
  setResponseHeader(event, 'Cache-Control', opts.cacheControl);
  if (opts.forwardAcceptLanguage) {
    setResponseHeader(event, 'Vary', 'Accept-Language');
  }
  setResponseHeader(event, 'X-Request-Id', requestId);
  return body;
}
