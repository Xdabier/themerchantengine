/**
 * Query-string redaction for the pino request serializer (constitution §3.7).
 *
 * The serializer logs `req.url` verbatim, query string included, and `redact`
 * only covers the `authorization` and `cookie` headers. Any endpoint that takes
 * personal data as a query parameter therefore writes it into every API log
 * line for that request, and into any reverse-proxy access log in front of it.
 *
 * The live case is `GET /v1/orders/:orderNumber/track?email=`, where the email
 * is the ownership challenge (pass-2 finding K10). Moving that challenge into a
 * POST body is a separate change; this rule holds regardless of which endpoints
 * exist, so it is enforced here rather than per route.
 *
 * Two layers, because neither alone is enough. The NAME layer catches a
 * parameter that is personal data by contract even when the value looks
 * innocuous. The VALUE layer catches an address that arrives through a
 * generically named parameter: `GET /v1/admin/customers?search=` is how an
 * operator looks a customer up, and no name-based rule would ever cover
 * `search` without also erasing every catalogue query term from the logs.
 */

/**
 * Query parameter names whose value is never written to a log line in clear.
 *
 * Personal data plus the credential shapes, because a parameter named like a
 * secret is one whether or not a route exists for it today. Substring-anchored
 * on purpose: `customerEmail` and `apiKey` match.
 *
 * `recipient` and `actor` are here because they carry an address in practice,
 * not by their name: `GET /v1/admin/notifications/log?recipient=` filters the
 * delivery log by email, and `GET /v1/admin/audit-log?actor=` is a free-text
 * search over the actor's name or email. Both are admin-gated, but an admin's
 * search terms are still personal data about somebody else, and the log line is
 * just as readable to whoever holds the log.
 */
export const NEVER_LOGGED_QUERY_PARAM_PATTERN =
  /(email|phone|password|secret|token|api[-_]?key|credential|otp|signature|recipient|actor)/i;

/**
 * A value that is an email address whatever the parameter is called.
 *
 * Matched against the raw wire value, so it accepts the percent-encoded `@`
 * (`%40`) that a client actually sends. Anchored to the whole value: a value
 * that merely contains an `@` somewhere is not necessarily an address, and the
 * point is to scrub addresses, not to blank every value with a stray symbol.
 */
const EMAIL_SHAPED_VALUE = /^[^@\s&=]+(?:@|%40)[^@\s&=]+\.[a-z]{2,}$/i;

const REDACTED = '[redacted]';

/**
 * Returns the URL with the value of every sensitive query parameter replaced.
 *
 * The path, the parameter names, the parameter order and every harmless value
 * are preserved, so a log line stays as useful for debugging as it was. A
 * parameter with no value (`?flag`) or an empty value (`?email=`) is left as
 * written: there is nothing to disclose and rewriting it would misreport the
 * request.
 */
export function redactUrl(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;

  const path = url.slice(0, queryStart);
  const query = url.slice(queryStart + 1);

  // Hand-split rather than URLSearchParams: that class re-encodes every pair on
  // the way out, so a logged URL would stop matching the one the client sent.
  const redacted = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (!value) return pair;
      const sensitive =
        NEVER_LOGGED_QUERY_PARAM_PATTERN.test(name) || EMAIL_SHAPED_VALUE.test(value);
      return sensitive ? `${name}=${REDACTED}` : pair;
    })
    .join('&');

  return `${path}?${redacted}`;
}

/**
 * Redacts every URL-with-a-query-string found inside a free-text string.
 *
 * `redactUrl` only ever saw `req.url`. An exception MESSAGE can embed the same
 * URL, and the one that always does is Nest's own route-not-found:
 * `Cannot GET /v1/orders/X/track?email=someone%40example.com`. The exception
 * filter logs `exception.message` verbatim beside a redacted `path`, so an
 * unmatched route wrote the address into the log in clear while the fields
 * either side of it were clean.
 *
 * Not specific to any route, which is why it lives here rather than in the
 * filter: a bot or a typo hitting `/v1/anything?email=` leaks the same way, and
 * an unmatched route is exactly the request nobody wrote a handler to guard.
 *
 * Matches a path-shaped run containing a `?`. Deliberately conservative: a
 * message with no URL, or a URL with no query string, comes back untouched, so
 * the log line stays as readable as it was.
 */
const URL_WITH_QUERY = /\/[^\s"'<>]*\?[^\s"'<>]*/g;

export function redactUrlsInText(text: string): string {
  if (typeof text !== 'string' || !text) return '';
  return text.replace(URL_WITH_QUERY, (match) => redactUrl(match));
}
