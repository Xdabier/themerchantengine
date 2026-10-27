import * as z from 'zod';

/**
 * Backend entity IDs are emitted as Prisma `cuid()` / `cuid2()` strings, NOT
 * UUIDs. The conservative pattern below accepts cuid, cuid2, and UUID so a
 * future migration to UUID/v4 stays compatible.
 */
export const entityIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid entity id');
export type EntityId = z.infer<typeof entityIdSchema>;

/**
 * `X-Idempotency-Key` is an opaque string per the API contract. Storefront
 * generates a UUID v4 server-side to feed it.
 */
export const uuidV4Schema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'Invalid UUID v4',
  );
export type UuidV4 = z.infer<typeof uuidV4Schema>;

/** URL slug — lowercase alphanumerics + dashes, no leading/trailing dash. */
export const slugSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid slug');
export type Slug = z.infer<typeof slugSchema>;

/**
 * Order numbers are sequence-backed strings emitted by the API
 * (`apps/api/src/modules/orders/orders.service.ts`). The shape varies by
 * deployment (e.g. `ORD-000123`, `AKL2026-0042`). The refinement here is
 * deliberately permissive — uppercase / digits / dash / underscore — so a
 * future format change does not break the storefront client.
 */
export const orderNumberSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Z0-9_-]+$/, 'Invalid order number');
export type OrderNumber = z.infer<typeof orderNumberSchema>;
