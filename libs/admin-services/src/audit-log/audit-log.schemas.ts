import * as z from 'zod';
import { paginationMetaSchema } from '@admin-types';

export const auditLogActorSchema = z.object({
  id: z.string(),
  email: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
});
export type AuditLogActor = z.infer<typeof auditLogActorSchema>;

export const auditLogEntrySchema = z.object({
  id: z.string(),
  userId: z.string().nullable().optional(),
  user: auditLogActorSchema.nullable().optional(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  action: z.string(),
  changes: z.unknown().optional(),
  before: z.unknown().nullable().optional(),
  after: z.unknown().nullable().optional(),
  ipAddress: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  correlationId: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const listAuditLogQuerySchema = z.object({
  userId: z.string().optional(),
  /** Name / email search over the joined actor, or the literal `system`. */
  actor: z.string().max(120).optional(),
  entityType: z.string().optional(),
  action: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().optional(),
});
export type ListAuditLogQuery = z.infer<typeof listAuditLogQuerySchema>;

export const listAuditLogResponseSchema = z.object({
  data: z.array(auditLogEntrySchema),
  meta: paginationMetaSchema,
});
export type ListAuditLogResponse = z.infer<typeof listAuditLogResponseSchema>;
