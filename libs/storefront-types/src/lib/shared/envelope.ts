import * as z from 'zod';

/**
 * Storefront response envelope per `docs/storefront-api-reference.md` §"Response envelopes".
 * Mirrors `libs/admin-types/src/envelope.ts` so the two clients share a single
 * envelope contract — diverging would let backend changes break only one
 * surface silently.
 */
export interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages?: number;
}

export const paginationMetaSchema = z.object({
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative().optional(),
});

export function apiResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema,
    meta: paginationMetaSchema.optional(),
  });
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

/** Extracts `.data` from a single-object response, asserting shape via Zod. */
export function unwrap<T>(envelope: unknown, dataSchema: z.ZodType<T>): T {
  return apiResponseSchema(dataSchema).parse(envelope).data;
}

/** Extracts `.data` + `.meta` from a paginated response. Throws if `meta` missing. */
export function unwrapPaginated<T>(
  envelope: unknown,
  dataSchema: z.ZodType<T>,
): { data: T; meta: PaginationMeta } {
  const parsed = apiResponseSchema(dataSchema).parse(envelope);
  if (!parsed.meta) {
    throw new Error('Expected pagination meta on response envelope');
  }
  return { data: parsed.data, meta: parsed.meta };
}
