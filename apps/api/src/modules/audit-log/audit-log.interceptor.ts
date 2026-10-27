import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from './audit-log.service';
import {
  AUDIT_METHODS,
  ENTITY_MODEL_MAP,
  ENTITY_TYPE_MAP,
  METHOD_ACTION_MAP,
} from './audit-log.constants';

// ─────────────────────────────────────────────────────────────────────────────

interface ParsedRoute {
  entityType: string;
  entityId: string | null;
  action: string;
  modelName: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Global interceptor that writes an immutable AuditLogEntry for every
 * successful mutating admin request (POST / PATCH / PUT / DELETE on /admin/*).
 *
 * Execution order (NestJS applies useGlobalInterceptors as outermost wrapper):
 *   ApiResponseInterceptor  ←  AuditLogInterceptor  ←  handler
 *
 * This means the interceptor sees the raw handler return value — before the
 * ApiResponseInterceptor wraps it in { data }.
 *
 * Before-state: fetched from the DB for PATCH/DELETE when an entityId is present.
 * After-state: raw handler response (null for DELETE where no body is returned).
 * Logging is fire-and-forget — failures are swallowed and logged.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    private readonly auditLogService: AuditLogService,
    private readonly prisma: PrismaService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request>();

    if (!this.shouldAudit(req)) {
      return next.handle();
    }

    const { entityType, entityId, action, modelName } = this.parseRoute(req);

    // Capture "before" state for mutations that operate on an existing entity
    const before =
      entityId && modelName && req.method !== 'POST'
        ? await this.fetchEntity(modelName, entityId)
        : null;

    return next.handle().pipe(
      tap((response: unknown) => {
        const after = req.method === 'DELETE' ? null : response;

        void this.auditLogService
          .log({
            userId: (req as Request & { user?: { id?: string } }).user?.id ?? null,
            action,
            entityType,
            entityId,
            changes: { before, after },
            ipAddress: req.ip ?? null,
            userAgent: req.headers['user-agent'] ?? null,
          })
          .catch((err: unknown) => {
            this.logger.error('Audit log tap error', err);
          });
      }),
    );
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private shouldAudit(req: Request): boolean {
    if (!AUDIT_METHODS.has(req.method)) return false;

    // Only audit /admin/ routes
    const path = req.path ?? '';
    return path.includes('/admin/');
  }

  /**
   * Extracts entityType, entityId, action, and Prisma model name from the
   * request URL.
   *
   * Route shape:  [/{prefix}]/v1/admin/{resource}/{id?}/{sub-action?}
   * Examples (no prefix):
   *   POST   /v1/admin/products           → product.create,  entityId=null
   *   PATCH  /v1/admin/products/abc123    → product.update,  entityId=abc123
   *   DELETE /v1/admin/orders/xyz/cancel  → order.delete,    entityId=xyz
   * Examples (API_GLOBAL_PREFIX=api):
   *   PATCH  /api/v1/admin/products/abc123 → product.update, entityId=abc123
   *
   * We locate the 'admin' segment dynamically so the parser is resilient to
   * any global prefix (e.g. API_GLOBAL_PREFIX=api shifts all indices by one).
   */
  private parseRoute(req: Request): ParsedRoute {
    const parts = (req.path ?? '').split('/').filter(Boolean);
    // Find 'admin' segment position dynamically — immune to global-prefix offset
    const adminIdx = parts.indexOf('admin');
    // resource segment sits immediately after 'admin'
    const resource = adminIdx >= 0 ? (parts[adminIdx + 1] ?? 'unknown') : 'unknown';

    const entityType = ENTITY_TYPE_MAP[resource] ?? resource;
    const modelName = ENTITY_MODEL_MAP[resource] !== undefined ? ENTITY_MODEL_MAP[resource] : null;

    // req.params.id is populated by Express after route matching — it is the
    // canonical source. The path-segment fallback (for controllers that don't
    // name their param `:id`) uses the segment right after the resource name,
    // which is immune to global-prefix offset.
    const params = req.params as Record<string, string | undefined>;
    const idSegment = adminIdx >= 0 ? parts[adminIdx + 2] : parts[3];
    const entityId = params['id'] ?? (this.looksLikeId(idSegment) ? (idSegment ?? null) : null);

    const verb = METHOD_ACTION_MAP[req.method] ?? 'mutate';
    const action = `${entityType}.${verb}`;

    return { entityType, entityId: entityId ?? null, action, modelName };
  }

  /** Fetches the current entity state from the DB. Returns null on any error. */
  private async fetchEntity(modelName: string, entityId: string): Promise<unknown> {
    try {
      // Dynamic Prisma model access — type-unsafe but intentional for generic lookup
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record = await (this.prisma as any)[modelName]?.findUnique({
        where: { id: entityId },
      });
      return record ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Heuristic to determine whether a URL segment looks like an entity ID
   * (UUID, CUID, or numeric) rather than a sub-resource path segment.
   */
  private looksLikeId(segment: string | undefined): boolean {
    if (!segment) return false;
    // UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment))
      return true;
    // CUID (starts with 'c', 20-30 alphanumeric chars)
    if (/^c[a-z0-9]{20,30}$/i.test(segment)) return true;
    // Numeric
    if (/^\d+$/.test(segment)) return true;
    return false;
  }
}
