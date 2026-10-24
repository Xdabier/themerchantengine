import { IsUUID, MaxLength, Matches } from 'class-validator';

/**
 * Header DTO for `X-Idempotency-Key` (§9.5 I1).
 *
 * Validates the header shape before the value reaches Redis. The pipe at
 * `apps/api/src/common/decorators/idempotency-key.decorator.ts` consumes
 * this DTO and throws `IdempotencyKeyMalformedException` on rejection.
 */
export class IdempotencyKeyHeaderDto {
  @IsUUID('4')
  @MaxLength(36)
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  key!: string;
}
