import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ApiError, ApiForbiddenError, ApiServerError, ApiUnauthorizedError } from '@admin-types';
import { GlobalErrorHandler } from './global-error-handler';

describe('GlobalErrorHandler', () => {
  let handler: GlobalErrorHandler;
  let navigate: jest.Mock;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    navigate = jest.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: { navigate } }],
    });
    handler = TestBed.inject(GlobalErrorHandler);
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => consoleSpy.mockRestore());

  it('routes ApiForbiddenError to /403', () => {
    handler.handleError(new ApiForbiddenError({ code: 'FORBIDDEN', message: 'no' }));
    expect(navigate).toHaveBeenCalledWith(['/403']);
  });

  it('swallows ApiUnauthorizedError (refreshInterceptor handles redirect)', () => {
    handler.handleError(new ApiUnauthorizedError({ code: 'UNAUTHORIZED', message: 'no' }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('routes 500 to /500 with correlation id', () => {
    handler.handleError(
      new ApiServerError({ code: 'INTERNAL', message: 'oops', correlationId: 'req-99' }),
    );
    expect(navigate).toHaveBeenCalledWith(['/500'], { queryParams: { correlationId: 'req-99' } });
  });

  it('routes generic 5xx with no correlation id', () => {
    handler.handleError(new ApiServerError({ code: 'INTERNAL', message: 'oops' }));
    expect(navigate).toHaveBeenCalledWith(['/500'], { queryParams: undefined });
  });

  it('ignores non-API errors from navigation (logs only)', () => {
    const error = new Error('unexpected');
    handler.handleError(error);
    expect(navigate).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("ignores ApiError with 4xx status that isn't specifically handled", () => {
    const err = new ApiError({ code: 'GONE', message: 'gone', status: 410 });
    handler.handleError(err);
    expect(navigate).not.toHaveBeenCalled();
  });
});
