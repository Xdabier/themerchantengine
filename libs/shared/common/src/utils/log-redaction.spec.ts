import { NEVER_LOGGED_QUERY_PARAM_PATTERN, redactUrl, redactUrlsInText } from './log-redaction';

describe('redactUrl', () => {
  it('scrubs an email value while keeping the path and the harmless params', () => {
    const redacted = redactUrl('/v1/orders/ORD-2026-000002/track?email=buyer@example.com&page=2');

    expect(redacted).toContain('/v1/orders/ORD-2026-000002/track');
    expect(redacted).toContain('page=2');
    expect(redacted).not.toContain('buyer@example.com');
    expect(redacted).not.toContain('@');
    expect(redacted).toContain('email=[redacted]');
  });

  it('scrubs credential-shaped params and leaves the rest alone', () => {
    const redacted = redactUrl('/v1/thing?token=abc123&api_key=k-1&phone=%2B21620000000&sort=name');

    expect(redacted).not.toContain('abc123');
    expect(redacted).not.toContain('k-1');
    expect(redacted).not.toContain('21620000000');
    expect(redacted).toContain('sort=name');
  });

  it('matches param names case-insensitively and however they are cased', () => {
    expect(redactUrl('/x?Email=a@b.co')).not.toContain('a@b.co');
    expect(redactUrl('/x?customerEmail=a@b.co')).not.toContain('a@b.co');
    expect(redactUrl('/x?apiKey=zzz')).not.toContain('zzz');
  });

  // The name layer would have to swallow `search` whole to cover this, which
  // would erase every catalogue query term from the logs as well.
  it('scrubs an address arriving through a generically named param', () => {
    expect(redactUrl('/v1/admin/customers?search=customer2@test.com')).toBe(
      '/v1/admin/customers?search=[redacted]',
    );
    expect(redactUrl('/v1/admin/customers?search=customer2%40test.com')).toBe(
      '/v1/admin/customers?search=[redacted]',
    );
  });

  it('keeps an ordinary search term readable', () => {
    expect(redactUrl('/v1/products?search=sidr%20honey&page=2')).toBe(
      '/v1/products?search=sidr%20honey&page=2',
    );
    expect(redactUrl('/x?search=a@')).toBe('/x?search=a@');
  });

  it('leaves a url with no query string untouched', () => {
    expect(redactUrl('/v1/products/iphone-15-pro')).toBe('/v1/products/iphone-15-pro');
  });

  it('keeps a valueless or empty param intact rather than dropping it', () => {
    expect(redactUrl('/x?flag&page=1')).toBe('/x?flag&page=1');
    expect(redactUrl('/x?email=')).toBe('/x?email=');
  });

  it('survives a malformed query rather than throwing', () => {
    expect(() => redactUrl('/x?%%%&email=a@b.co')).not.toThrow();
    expect(redactUrl('/x?%%%&email=a@b.co')).not.toContain('a@b.co');
  });

  it('handles a repeated param', () => {
    const redacted = redactUrl('/x?email=one@b.co&email=two@b.co');
    expect(redacted).not.toContain('one@b.co');
    expect(redacted).not.toContain('two@b.co');
  });

  it('pins the pattern so a rename cannot quietly widen what is logged', () => {
    for (const name of [
      'email',
      'phone',
      'token',
      'password',
      'secret',
      'apiKey',
      'api_key',
      'recipient',
      'actor',
    ]) {
      expect(NEVER_LOGGED_QUERY_PARAM_PATTERN.test(name)).toBe(true);
    }
    for (const name of ['page', 'pageSize', 'sortBy', 'status', 'slug']) {
      expect(NEVER_LOGGED_QUERY_PARAM_PATTERN.test(name)).toBe(false);
    }
  });
});

/**
 * `redactUrl` only ever saw `req.url`. An exception MESSAGE can embed the same
 * URL, and the one that does is Nest's own route-not-found:
 * `Cannot GET /v1/orders/X/track?email=someone%40example.com`. The exception
 * filter logs `exception.message` verbatim alongside the redacted `path`, so a
 * request to any unmatched route wrote the address into the log in clear while
 * the two fields either side of it were clean.
 *
 * Surfaced by plan M phase M3, which removed a route and so made every probe of
 * it an unmatched-route 404. The hole is not specific to that route: a bot or a
 * typo hitting `/v1/anything?email=` leaks the same way.
 */
describe('redactUrlsInText', () => {
  it('redacts a url embedded in a Nest route-not-found message', () => {
    expect(redactUrlsInText('Cannot GET /v1/orders/ORD-1/track?email=someone%40example.com')).toBe(
      'Cannot GET /v1/orders/ORD-1/track?email=[redacted]',
    );
  });

  it('redacts an email-shaped value under a generically named parameter', () => {
    expect(redactUrlsInText('Cannot GET /v1/admin/customers?search=a%40b.com')).toBe(
      'Cannot GET /v1/admin/customers?search=[redacted]',
    );
  });

  it('leaves a harmless query alone so the message stays useful', () => {
    const msg = 'Cannot GET /v1/products?page=2&sortBy=price';
    expect(redactUrlsInText(msg)).toBe(msg);
  });

  it('leaves a message with no url alone', () => {
    expect(redactUrlsInText('Order not found')).toBe('Order not found');
    expect(redactUrlsInText('')).toBe('');
  });

  it('leaves a url with no query string alone', () => {
    expect(redactUrlsInText('Cannot POST /v1/orders/track')).toBe('Cannot POST /v1/orders/track');
  });

  it('redacts every url in a message that carries more than one', () => {
    expect(redactUrlsInText('/a?email=x%40y.com then /b?token=abc123 done')).toBe(
      '/a?email=[redacted] then /b?token=[redacted] done',
    );
  });

  it('handles a non-string without throwing', () => {
    expect(redactUrlsInText(undefined as unknown as string)).toBe('');
    expect(redactUrlsInText(null as unknown as string)).toBe('');
  });
});
