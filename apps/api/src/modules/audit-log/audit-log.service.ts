import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_LOG_DEFAULT_PAGE_SIZE } from './audit-log.constants';
import { ListAuditLogDto } from './dto';

export interface AuditLogInput {
  userId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  changes: { before: unknown; after: unknown };
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes an immutable audit log entry.
   * Fire-and-forget from the interceptor — never throws to callers.
   */
  async log(input: AuditLogInput): Promise<void> {
    try {
      await this.prisma.auditLogEntry.create({
        data: {
          userId: input.userId,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          changes: JSON.parse(JSON.stringify(input.changes)),
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      });
    } catch (err) {
      // Never let audit-log failures surface to the caller
      this.logger.error('Failed to write audit log entry', err);
    }
  }

  /** Paginated list filterable by userId, entityType, action, and date range. */
  async list(dto: ListAuditLogDto) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? AUDIT_LOG_DEFAULT_PAGE_SIZE;
    const skip = (page - 1) * pageSize;

    const where = buildWhere(dto);

    const [items, total] = await Promise.all([
      this.prisma.auditLogEntry.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      }),
      this.prisma.auditLogEntry.count({ where }),
    ]);

    return { data: items, meta: { page, pageSize, total } };
  }

  /** All audit log entries for a specific entity, newest first. */
  async getByEntity(entityType: string, entityId: string, dto: ListAuditLogDto) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? AUDIT_LOG_DEFAULT_PAGE_SIZE;
    const skip = (page - 1) * pageSize;

    const where = { entityType, entityId };

    const [items, total] = await Promise.all([
      this.prisma.auditLogEntry.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      }),
      this.prisma.auditLogEntry.count({ where }),
    ]);

    return { data: items, meta: { page, pageSize, total } };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** The actor term the UI shows for an entry with no user. */
const SYSTEM_ACTOR = 'system';

function buildWhere(dto: ListAuditLogDto) {
  const where: Record<string, unknown> = {};

  if (dto.userId) where['userId'] = dto.userId;
  if (dto.entityType) where['entityType'] = dto.entityType;
  if (dto.action) where['action'] = { contains: dto.action };

  const actor = dto.actor?.trim();
  if (actor) {
    // Prisma parameterizes `contains`, so the term is never interpolated.
    const nameMatch = {
      OR: [
        { firstName: { contains: actor, mode: 'insensitive' } },
        { lastName: { contains: actor, mode: 'insensitive' } },
        { email: { contains: actor, mode: 'insensitive' } },
      ],
    };

    if (actor.toLowerCase() === SYSTEM_ACTOR) {
      // `system` is the label for an entry with no user, but it is also a name
      // a staff member can give themselves through PATCH /v1/users/me. Match
      // both, so the filter is a superset and can never quietly hide an actor
      // from the one query used to review unattributed activity. Sitting in
      // `OR` also leaves an explicit `userId` filter intact: a contradictory
      // pair honestly returns nothing rather than answering a different
      // question on a forensic surface.
      where['OR'] = [{ userId: null }, { user: nameMatch }];
    } else {
      where['user'] = nameMatch;
    }
  }

  if (dto.from || dto.to) {
    where['createdAt'] = {
      ...(dto.from && { gte: new Date(dto.from) }),
      ...(dto.to && { lte: new Date(dto.to) }),
    };
  }

  return where;
}
