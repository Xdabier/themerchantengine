import * as z from 'zod';

/**
 * Backend entity IDs are Prisma `cuid()` / `cuid2()` strings, NOT UUIDs.
 * Every admin schema that previously used `z.string().uuid()` should use this
 * instead — it accepts cuid, cuid2, and UUID so schemas remain compatible if
 * we migrate the default later.
 *
 * Shape check is intentionally relaxed to a conservative character set so we
 * don't reject fresh cuid variants prisma may emit on future upgrades.
 */
export const entityIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid entity id');
export type EntityId = z.infer<typeof entityIdSchema>;
