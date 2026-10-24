import * as z from 'zod';

/**
 * Backend response envelope per CLAUDE.md §Response Format.
 * Applies to ALL successful responses.
 */
export interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
}

/** Pagination meta attached to collection responses. */
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

/** Helper to build a typed envelope schema around a data shape. */
export function apiResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema,
    meta: paginationMetaSchema.optional(),
  });
}

/** Error envelope used by backend on 4xx + 5xx. */
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

/** Extracts `.data` from a response, asserting the shape via Zod. */
export function unwrap<T>(envelope: unknown, dataSchema: z.ZodType<T>): T {
  const parsed = apiResponseSchema(dataSchema).parse(envelope);
  return parsed.data;
}

/** Extracts both data + meta from a paginated response. */
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
