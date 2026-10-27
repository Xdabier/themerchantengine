import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { PaginatedResult } from '@common/interceptors/api-response.interceptor';
import type { CreateCarrierDto } from './dto/create-carrier.dto';
import type { ListCarriersDto } from './dto/query-carriers.dto';
import type { UpdateCarrierDto } from './dto/update-carrier.dto';

/** Mirror of PaymentMethodsService's secret masking — same key set. */
const MASKED_CONFIG_KEYS = new Set([
  'apiKey',
  'accountNumber',
  'clientSecret',
  'privateKey',
  'signingSecret',
]);
const MASKED_PLACEHOLDER = '***';

export interface CarrierResult {
  id: string;
  code: string;
  name: unknown;
  provider: string;
  services: string[];
  zones: string[];
  isActive: boolean;
  sortOrder: number;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CarriersService {
  private readonly logger = new Logger(CarriersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListCarriersDto): Promise<PaginatedResult<CarrierResult>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      deletedAt: null,
      ...(query.provider !== undefined && { provider: query.provider }),
      ...(query.isActive !== undefined && { isActive: query.isActive }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.carrier.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.carrier.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.toResult(r)),
      meta: { page, pageSize, total },
    };
  }

  async findOne(id: string): Promise<CarrierResult> {
    const row = await this.prisma.carrier.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException(`Carrier "${id}" not found`);
    return this.toResult(row);
  }

  async create(dto: CreateCarrierDto): Promise<CarrierResult> {
    const existing = await this.prisma.carrier.findUnique({
      where: { code: dto.code },
      select: { id: true },
    });
    if (existing) throw new ConflictException(`Carrier code "${dto.code}" already in use`);

    const row = await this.prisma.carrier.create({
      data: {
        code: dto.code,
        name: dto.name as never,
        provider: dto.provider,
        services: dto.services ?? [],
        zones: dto.zones ?? [],
        isActive: dto.isActive ?? false,
        sortOrder: dto.sortOrder ?? 0,
        config: (dto.config ?? {}) as never,
      },
    });
    this.logger.log(`create: code=${dto.code} provider=${dto.provider}`);
    return this.toResult(row);
  }

  async update(id: string, dto: UpdateCarrierDto): Promise<CarrierResult> {
    const existing = await this.prisma.carrier.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException(`Carrier "${id}" not found`);

    const mergedConfig =
      dto.config !== undefined
        ? this.mergeConfig(existing.config as Record<string, unknown>, dto.config)
        : undefined;

    const row = await this.prisma.carrier.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name as never }),
        ...(dto.services !== undefined && { services: dto.services }),
        ...(dto.zones !== undefined && { zones: dto.zones }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(mergedConfig !== undefined && { config: mergedConfig as never }),
      },
    });
    return this.toResult(row);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.carrier.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(`Carrier "${id}" not found`);

    await this.prisma.carrier.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  private mergeConfig(
    current: Record<string, unknown>,
    delta: Record<string, unknown>,
  ): Record<string, unknown> {
    const next = { ...current };
    for (const [k, v] of Object.entries(delta)) {
      if (v === MASKED_PLACEHOLDER) continue;
      if (v === null) {
        delete next[k];
        continue;
      }
      next[k] = v;
    }
    return next;
  }

  private maskConfig(config: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(config ?? {})) {
      if (MASKED_CONFIG_KEYS.has(k) && typeof v === 'string' && v.length > 0) {
        out[k] = MASKED_PLACEHOLDER;
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  private toResult(row: {
    id: string;
    code: string;
    name: unknown;
    provider: string;
    services: string[];
    zones: string[];
    isActive: boolean;
    sortOrder: number;
    config: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): CarrierResult {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      provider: row.provider,
      services: row.services,
      zones: row.zones,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      config: this.maskConfig((row.config ?? {}) as Record<string, unknown>),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
