import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client-runtime-utils';
import { HttpExceptionFilter } from './http-exception.filter';

// ── Helpers ──────────────────────────────────────────────────────────────────

interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
}

interface CapturedResponse {
  status: number;
  body: unknown;
}

function makeMockHost(overrides: Partial<{ correlationId: string; url: string }> = {}): {
  host: ArgumentsHost;
  captured: CapturedResponse;
} {
  const captured: CapturedResponse = { status: 0, body: null };

  const json = jest.fn().mockImplementation((body: unknown) => {
    captured.body = body;
  });
  const status = jest.fn().mockImplementation((code: number) => {
    captured.status = code;
    return { json };
  });

  const res: MockResponse = { status, json };

  const req = {
    url: overrides.url ?? '/test',
    method: 'GET',
    id: overrides.correlationId ?? 'test-correlation-id',
    headers: {},
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => req,
    }),
  } as unknown as ArgumentsHost;

  return { host, captured };
}

// ── HttpException handling ───────────────────────────────────────────────────

describe('HttpExceptionFilter — HttpException', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    process.env.NODE_ENV = 'test';
  });

  it('returns 404 NOT_FOUND for NotFoundException', () => {
    const { host, captured } = makeMockHost();
    filter.catch(new NotFoundException('Item not found'), host);

    expect(captured.status).toBe(HttpStatus.NOT_FOUND);
    const body = captured.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Item not found');
  });

  it('returns 401 UNAUTHORIZED for UnauthorizedException', () => {
    const { host, captured } = makeMockHost();
    filter.catch(new UnauthorizedException(), host);

    expect(captured.status).toBe(HttpStatus.UNAUTHORIZED);
    const body = captured.body as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 FORBIDDEN for ForbiddenException', () => {
    const { host, captured } = makeMockHost();
    filter.catch(new ForbiddenException(), host);

    expect(captured.status).toBe(HttpStatus.FORBIDDEN);
    const body = captured.body as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('preserves VALIDATION_ERROR code from pre-formatted ValidationPipe errors', () => {
    const { host, captured } = makeMockHost();
    const exception = new BadRequestException({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'email', messages: ['must be an email'] }],
      },
    });

    filter.catch(exception, host);

    expect(captured.status).toBe(HttpStatus.BAD_REQUEST);
    const body = captured.body as {
      error: { code: string; message: string; details: unknown };
    };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Validation failed');
    expect(body.error.details).toBeDefined();
  });

  it('strips details in production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const { host, captured } = makeMockHost();
    const exception = new BadRequestException({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'email' }],
      },
    });

    filter.catch(exception, host);

    const body = captured.body as { error: { details?: unknown } };
    expect(body.error.details).toBeUndefined();

    process.env.NODE_ENV = originalEnv;
  });

  it.each([['staging'], ['prod'], [undefined]])(
    'strips details under NODE_ENV=%s, because every label outside test and development is production',
    (label) => {
      const originalEnv = process.env.NODE_ENV;
      if (label === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = label;

      const { host, captured } = makeMockHost();
      filter.catch(
        new BadRequestException({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: [{ field: 'email' }],
          },
        }),
        host,
      );

      const body = captured.body as { error: { details?: unknown } };
      expect(body.error.details).toBeUndefined();

      if (originalEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalEnv;
    },
  );

  it('returns 500 INTERNAL_SERVER_ERROR for unhandled errors', () => {
    const { host, captured } = makeMockHost();
    filter.catch(new Error('Something exploded'), host);

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = captured.body as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('uses generic message for unknown errors in production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const { host, captured } = makeMockHost();
    filter.catch(new Error('Sensitive internals'), host);

    const body = captured.body as { error: { message: string } };
    expect(body.error.message).toBe('Internal server error.');

    process.env.NODE_ENV = originalEnv;
  });

  it('returns 500 for InternalServerErrorException', () => {
    const { host, captured } = makeMockHost();
    filter.catch(new InternalServerErrorException('db down'), host);

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = captured.body as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
  });
});

// ── Prisma error handling ────────────────────────────────────────────────────

describe('HttpExceptionFilter — PrismaClientKnownRequestError', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    process.env.NODE_ENV = 'test';
  });

  function makePrismaError(code: string) {
    const err = new Error('Prisma error') as Error & {
      code: string;
      clientVersion: string;
    };
    err.code = code;
    err.clientVersion = '7.0.0';
    Object.setPrototypeOf(err, PrismaClientKnownRequestError.prototype);
    return err;
  }

  it('maps P2002 (unique constraint) to 409 CONFLICT', () => {
    const { host, captured } = makeMockHost();
    filter.catch(makePrismaError('P2002'), host);

    expect(captured.status).toBe(HttpStatus.CONFLICT);
    const body = captured.body as { error: { code: string } };
    expect(body.error.code).toBe('CONFLICT');
  });

  it('maps P2025 (record not found) to 404 NOT_FOUND', () => {
    const { host, captured } = makeMockHost();
    filter.catch(makePrismaError('P2025'), host);

    expect(captured.status).toBe(HttpStatus.NOT_FOUND);
    const body = captured.body as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('maps unknown Prisma codes to 500 INTERNAL_SERVER_ERROR', () => {
    const { host, captured } = makeMockHost();
    filter.catch(makePrismaError('P9999'), host);

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = captured.body as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
  });
});

/**
 * Constitution §3.7. The filter redacted `path` but logged `exception.message`
 * verbatim, and Nest's route-not-found message embeds the raw request URL,
 * query string included.
 */
describe('HttpExceptionFilter message redaction', () => {
  it('redacts a url embedded in the logged exception message', () => {
    const logged: Record<string, unknown>[] = [];
    const filter = new HttpExceptionFilter();
    (filter as unknown as { logger: { error: (o: unknown) => void } }).logger = {
      error: (o) => logged.push(o as Record<string, unknown>),
    };

    filter.catch(
      new NotFoundException('Cannot GET /v1/orders/ORD-1/track?email=someone%40example.com'),
      makeMockHost({ url: '/v1/orders/ORD-1/track?email=someone%40example.com' }).host,
    );

    expect(logged).toHaveLength(1);
    const entry = logged[0];
    expect(String(entry['message'])).not.toContain('someone');
    expect(String(entry['message'])).not.toContain('%40');
    expect(String(entry['message'])).toContain('[redacted]');
    // The path either side of it was already clean and must stay clean.
    expect(String(entry['path'])).toContain('[redacted]');
  });

  it('leaves an ordinary exception message intact', () => {
    const logged: Record<string, unknown>[] = [];
    const filter = new HttpExceptionFilter();
    (filter as unknown as { logger: { error: (o: unknown) => void } }).logger = {
      error: (o) => logged.push(o as Record<string, unknown>),
    };

    filter.catch(new NotFoundException('Order not found'), makeMockHost().host);

    expect(String(logged[0]['message'])).toBe('Order not found');
  });
});
