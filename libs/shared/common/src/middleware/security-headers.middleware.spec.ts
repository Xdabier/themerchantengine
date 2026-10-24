import { Request, Response } from 'express';
import { SecurityHeadersMiddleware, SECURITY_HEADERS } from './security-headers.middleware';

function makeRes() {
  const headers: Record<string, string> = {};
  const res = {
    headers,
    setHeader: jest.fn((key: string, value: string) => {
      headers[key] = value;
    }),
  };
  return res as unknown as Response & { headers: Record<string, string> };
}

function makeReq() {
  return {} as Request;
}

describe('SecurityHeadersMiddleware', () => {
  let middleware: SecurityHeadersMiddleware;
  let next: jest.Mock;

  beforeEach(() => {
    middleware = new SecurityHeadersMiddleware();
    next = jest.fn();
  });

  it('calls next()', () => {
    middleware.use(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets Content-Security-Policy', () => {
    const res = makeRes();
    middleware.use(makeReq(), res, next);

    const csp = res.headers['Content-Security-Policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: https://*.s3.amazonaws.com");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it('sets Strict-Transport-Security with 1-year max-age and includeSubDomains', () => {
    const res = makeRes();
    middleware.use(makeReq(), res, next);

    expect(res.headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('sets X-Content-Type-Options: nosniff', () => {
    const res = makeRes();
    middleware.use(makeReq(), res, next);
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('sets X-Frame-Options: DENY', () => {
    const res = makeRes();
    middleware.use(makeReq(), res, next);
    expect(res.headers['X-Frame-Options']).toBe('DENY');
  });

  it('sets Referrer-Policy: strict-origin-when-cross-origin', () => {
    const res = makeRes();
    middleware.use(makeReq(), res, next);
    expect(res.headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it('sets exactly the headers defined in SECURITY_HEADERS', () => {
    const res = makeRes();
    middleware.use(makeReq(), res, next);

    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers[key]).toBe(value);
    }
  });

  it('does not suppress other response headers', () => {
    const res = makeRes();
    res.setHeader('X-Custom-Header', 'already-set');
    middleware.use(makeReq(), res, next);

    // Pre-existing header must still be there
    expect(res.headers['X-Custom-Header']).toBe('already-set');
  });
});
