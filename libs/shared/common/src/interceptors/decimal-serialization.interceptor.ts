import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Prisma } from '@prisma/client';

/**
 * Converts Prisma `Decimal` values in a response payload to plain numbers.
 *
 * Prisma returns `Decimal(10,2)` columns (prices, totals, balances, tax rates,
 * …) as `decimal.js` instances. `ClassSerializerInterceptor`'s `instanceToPlain`
 * does not recognise them and serialises a `Decimal` as its internal
 * `{ s, e, d }` shape — so without this interceptor every money field reaches
 * the client as an object, not a number.
 *
 * It is registered LAST in the global interceptor chain (see `main.ts`) so it
 * runs FIRST on the response path — converting `Decimal` → `number` before
 * `ClassSerializerInterceptor` would otherwise mangle it. This keeps
 * `ClassSerializerInterceptor` in place for its `@Exclude`/`@Expose` duties
 * (constitution §8.1 API3) while making money serialise correctly.
 */
@Injectable()
export class DecimalSerializationInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => convertDecimals(data)));
  }
}

function isDecimal(value: unknown): value is { toNumber(): number } {
  return (
    value instanceof Prisma.Decimal ||
    (typeof value === 'object' &&
      value !== null &&
      typeof (value as { toNumber?: unknown }).toNumber === 'function')
  );
}

function convertDecimals(value: unknown): unknown {
  if (isDecimal(value)) return value.toNumber();
  if (Array.isArray(value)) return value.map(convertDecimals);
  if (
    value !== null &&
    typeof value === 'object' &&
    !(value instanceof Date) &&
    !Buffer.isBuffer(value)
  ) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = convertDecimals((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
