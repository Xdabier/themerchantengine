import { CorrelationIdMiddleware } from './correlation-id.middleware';
import { Request, Response } from 'express';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function makeRes(): { setHeader: jest.Mock; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: jest.fn((key: string, value: string) => {
      headers[key] = value;
    }),
  };
}

describe('CorrelationIdMiddleware', () => {
  let middleware: CorrelationIdMiddleware;
  let next: jest.Mock;

  beforeEach(() => {
    middleware = new CorrelationIdMiddleware();
    next = jest.fn();
  });

  it('uses the incoming X-Request-Id when provided', () => {
    const req = makeReq({ 'x-request-id': 'my-correlation-id' });
    const res = makeRes();

    middleware.use(req, res as unknown as Response, next);

    expect((req as Request & { id: string }).id).toBe('my-correlation-id');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'my-correlation-id');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('generates a UUID when X-Request-Id is absent', () => {
    const req = makeReq();
    const res = makeRes();

    middleware.use(req, res as unknown as Response, next);

    const id = (req as Request & { id: string }).id;
    expect(id).toMatch(UUID_REGEX);
    expect(res.headers['X-Request-Id']).toBe(id);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('generates a different UUID on each request', () => {
    const req1 = makeReq();
    const req2 = makeReq();
    const res = makeRes();

    middleware.use(req1, res as unknown as Response, next);
    middleware.use(req2, res as unknown as Response, next);

    expect((req1 as Request & { id: string }).id).not.toBe((req2 as Request & { id: string }).id);
  });

  it('trims whitespace from the incoming header value', () => {
    const req = makeReq({ 'x-request-id': '  trimmed-id  ' });
    const res = makeRes();

    middleware.use(req, res as unknown as Response, next);

    expect((req as Request & { id: string }).id).toBe('trimmed-id');
  });

  it('generates a UUID when header is an empty string', () => {
    const req = makeReq({ 'x-request-id': '' });
    const res = makeRes();

    middleware.use(req, res as unknown as Response, next);

    expect((req as Request & { id: string }).id).toMatch(UUID_REGEX);
  });

  it('calls next()', () => {
    middleware.use(makeReq(), makeRes() as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });
});
