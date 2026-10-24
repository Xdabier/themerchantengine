import { ExecutionContext, Injectable, PipeTransform, createParamDecorator } from '@nestjs/common';
import { validateSync } from 'class-validator';
import {
  IdempotencyKeyMalformedException,
  IdempotencyKeyRequiredException,
} from '../exceptions/idempotency.exception';
import { IdempotencyKeyHeaderDto } from '../dto/idempotency-key-header.dto';

/**
 * Reads `X-Idempotency-Key` from the request and returns the raw string.
 *
 * Use with `@IdempotencyKey() key: string` on sensitive-write endpoints.
 * Pair with `IdempotencyKeyPipe` to enforce shape:
 *
 *   `@Post('orders')
 *    createOrder(@IdempotencyKey(IdempotencyKeyPipe) key: string) { ... }`
 *
 * The decorator alone does not throw; the pipe enforces presence + format.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    const raw = request.headers['x-idempotency-key'];
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
    return undefined;
  },
);

@Injectable()
export class IdempotencyKeyPipe implements PipeTransform<string | undefined, string> {
  transform(value: string | undefined): string {
    if (value === undefined || value === '') {
      throw new IdempotencyKeyRequiredException();
    }
    const dto = new IdempotencyKeyHeaderDto();
    dto.key = value;
    const errors = validateSync(dto);
    if (errors.length > 0) {
      throw new IdempotencyKeyMalformedException();
    }
    return value;
  }
}
