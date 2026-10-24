import { of } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { ApiResponseInterceptor } from './api-response.interceptor';

function makeContext(): ExecutionContext {
  return {} as ExecutionContext;
}

function makeHandler(data: unknown): CallHandler {
  return { handle: () => of(data) } as CallHandler;
}

describe('ApiResponseInterceptor', () => {
  let interceptor: ApiResponseInterceptor;

  beforeEach(() => {
    interceptor = new ApiResponseInterceptor();
  });

  it('wraps a plain object in { data }', (done) => {
    const ctx = makeContext();
    const handler = makeHandler({ id: '1', name: 'Widget' });

    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect(result).toEqual({ data: { id: '1', name: 'Widget' } });
      done();
    });
  });

  it('wraps an array in { data }', (done) => {
    const ctx = makeContext();
    const handler = makeHandler([{ id: '1' }, { id: '2' }]);

    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect(result).toEqual({ data: [{ id: '1' }, { id: '2' }] });
      done();
    });
  });

  it('wraps null in { data: null }', (done) => {
    const ctx = makeContext();
    const handler = makeHandler(null);

    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect(result).toEqual({ data: null });
      done();
    });
  });

  it('wraps a scalar string in { data }', (done) => {
    const ctx = makeContext();
    const handler = makeHandler('ok');

    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect(result).toEqual({ data: 'ok' });
      done();
    });
  });

  it('passes through a PaginatedResult as { data, meta }', (done) => {
    const paginated = {
      data: [{ id: '1' }, { id: '2' }],
      meta: { page: 1, pageSize: 20, total: 50, totalPages: 3 },
    };
    const ctx = makeContext();
    const handler = makeHandler(paginated);

    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect(result).toEqual(paginated);
      done();
    });
  });

  it('does not treat { data, meta } without total as paginated', (done) => {
    const notPaginated = {
      data: [{ id: '1' }],
      meta: { foo: 'bar' },
    };
    const ctx = makeContext();
    const handler = makeHandler(notPaginated);

    interceptor.intercept(ctx, handler).subscribe((result) => {
      // No total → treated as a plain object, wrapped
      expect(result).toEqual({ data: notPaginated });
      done();
    });
  });

  it('wraps an object that has data but no meta', (done) => {
    const plain = { data: 'something' };
    const ctx = makeContext();
    const handler = makeHandler(plain);

    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect(result).toEqual({ data: plain });
      done();
    });
  });
});
