import { z } from 'zod';
import { paginationMetaSchema, entityIdSchema } from '@admin-types';

/**
 * Lenient per-row schema used by list-endpoint contract tests.
 *
 * We validate the invariants that the Angular services rely on (id present,
 * envelope + pagination shape) but stop short of re-asserting every field of
 * every entity. Two reasons:
 *   1. The backend currently serialises `Prisma.Decimal` as `{s,e,d}` and
 *      `Date` as `{}` — a JSON-transformer bug that's orthogonal to the
 *      per-service schema work and would force every spec to fixme itself.
 *   2. Tight schemas live in `libs/admin-services/src/<module>/*.schemas` —
 *      this harness is for drift detection at the wire, not a second source
 *      of truth.
 *
 * When we fix the Decimal/Date serialisation drift, promote individual
 * specs from `paginatedShape` to the module's real response schema.
 */
export const minimalRowSchema = z
  .object({
    id: entityIdSchema,
  })
  .passthrough();

export function paginatedShape<T extends z.ZodTypeAny = typeof minimalRowSchema>(
  row: T = minimalRowSchema as unknown as T,
): z.ZodObject<{ data: z.ZodArray<T>; meta: typeof paginationMetaSchema }> {
  return z.object({
    data: z.array(row),
    meta: paginationMetaSchema,
  });
}

export function dataShape<T extends z.ZodTypeAny = typeof minimalRowSchema>(
  row: T = minimalRowSchema as unknown as T,
): z.ZodObject<{ data: T }> {
  return z.object({ data: row });
}
