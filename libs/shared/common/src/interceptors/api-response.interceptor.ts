import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse, PaginationMeta } from '../interfaces';

/**
 * Shape returned by service/repository layers for paginated results.
 * Controllers return this directly; the interceptor reshapes it to ApiResponse.
 */
export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

function isPaginatedResult(value: unknown): value is PaginatedResult<unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    'data' in obj &&
    Array.isArray(obj['data']) &&
    'meta' in obj &&
    obj['meta'] !== null &&
    typeof obj['meta'] === 'object' &&
    'total' in (obj['meta'] as object)
  );
}

/**
 * Global interceptor that wraps all successful responses in { data: T }.
 *
 * - Plain value / array  → { data: value }
 * - PaginatedResult      → { data: T[], meta: { page, pageSize, total, totalPages } }
 *
 * Services signal pagination by returning a PaginatedResult object.
 */
@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<ApiResponse<unknown>> {
    return next.handle().pipe(
      map((data): ApiResponse<unknown> => {
        if (isPaginatedResult(data)) {
          return { data: data.data, meta: data.meta };
        }
        return { data };
      }),
    );
  }
}
