import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Models that implement soft-delete via `deletedAt DateTime?`.
 * The soft-delete middleware auto-filters these to WHERE deletedAt IS NULL.
 * To bypass (e.g. admin recovery), include `deletedAt` in the where clause:
 *   { where: { deletedAt: { not: null } } }
 */
export const SOFT_DELETE_MODELS = [
  'User',
  'Product',
  'ProductVariant',
  'Category',
  'Cart',
  'Promotion',
  'GiftCard',
  'ShippingZone',
  'ShippingMethod',
  'TaxZone',
  'StorefrontSection',
  'CmsPage',
  'Brand',
  'Carrier',
  'PaymentMethod',
  // NE7 — soft-delete retrofit (Risk R8) + the new consent model.
  'EmailSuppression',
  'Notification',
  'NotificationPreference',
  // NE9 — marketing / broadcast plane.
  'Subscriber',
  'Campaign',
  'CampaignSend',
] as const;

export type SoftDeleteModel = (typeof SOFT_DELETE_MODELS)[number];

/**
 * Pure function — applies the soft-delete filter to query args.
 * Exported for unit testing.
 */
export function applySoftDeleteFilter(
  model: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!SOFT_DELETE_MODELS.includes(model as SoftDeleteModel)) return args;

  const where = (args.where ?? {}) as Record<string, unknown>;

  // Bypass: caller already specified a deletedAt condition
  if ('deletedAt' in where) return args;

  return { ...args, where: { ...where, deletedAt: null } };
}

/**
 * Factory — creates a PrismaClient extended with the soft-delete query middleware.
 * Prisma 7 uses $extends (replaces the deprecated $use middleware API).
 *
 * Exported so the Better Auth instance (`apps/api/src/auth/auth.ts`) can give
 * its Prisma adapter the SAME soft-delete-extended client — without it, a
 * soft-deleted user could still sign in (constitution / spec §4.D6).
 */
export function createExtendedPrismaClient() {
  const adapter = new PrismaPg(process.env.DATABASE_URL!);
  return new PrismaClient({ adapter }).$extends({
    query: {
      $allModels: {
        async findMany({
          model,
          args,
          query,
        }: {
          model: string;
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          return query(applySoftDeleteFilter(model, args));
        },

        async findFirst({
          model,
          args,
          query,
        }: {
          model: string;
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          return query(applySoftDeleteFilter(model, args));
        },

        async findUnique({
          model,
          args,
          query,
        }: {
          model: string;
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          return query(applySoftDeleteFilter(model, args));
        },

        /**
         * `count` was missing, and the gap was inert until D4.
         *
         * Every paginated admin list runs a filtered `findMany` beside an
         * unfiltered `count`, so `data` excluded soft-deleted rows while
         * `meta.total` included them. Nothing had ever soft-deleted a
         * `TaxZone`, `ShippingZone` or `ShippingMethod`, so the two agreed by
         * accident. D4's seed retires the previous client's zones, which is
         * the first time any row in those models is soft-deleted, and the
         * counts diverged immediately: 38 against 37 on the dev database.
         *
         * A wrong `meta.total` is not only a wrong "N results" label; it
         * drives last-page detection, so the final page of a list can be one
         * the operator can reach and that renders nothing.
         */
        async count({
          model,
          args,
          query,
        }: {
          model: string;
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          return query(applySoftDeleteFilter(model, args));
        },
      },
    },
  });
}

type ExtendedPrismaClient = ReturnType<typeof createExtendedPrismaClient>;

/**
 * Intermediate base class that lets PrismaService extend the extended client.
 * This is the Prisma-recommended pattern for using $extends with NestJS.
 */
const ExtendedPrismaClientBase = class {
  constructor() {
    return createExtendedPrismaClient();
  }
} as unknown as new () => ExtendedPrismaClient;

@Injectable()
export class PrismaService
  extends ExtendedPrismaClientBase
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
