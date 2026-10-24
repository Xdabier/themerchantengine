import { SectionType, type Prisma, type PrismaClient } from '@prisma/client';

import type { StoreRuntimeConfig } from '../../../libs/shared/common/src/store-config-fixtures/store-config-fixture.schema';

/**
 * The home page a freshly installed engine serves (plan E2.5.2).
 *
 * Before this the baseline seed planted no sections at all and left the home
 * page to a per-client seeder, so a store installed from this tree rendered an
 * empty home page until somebody wrote rows by hand. That was defensible while
 * one branch per client existed; DR-31 removed the branch.
 *
 * Up to three sections, chosen because each renders from rows the store already
 * has rather than from content nobody has authored yet: its top-level
 * categories (skipped when it has none), the products it has marked featured
 * (skipped when it has none), and a trust strip that is pure copy. No hero and
 * no promotional banner: both need an uploaded image, and an empty image slot
 * on the first page a customer sees is worse than no section.
 *
 * The seed upserts by stable id, so a re-run resets these three rows to the
 * defaults. It never deletes a row it did not plant, so a section the operator
 * removed stays removed.
 */
export const DEFAULT_HOME_SECTION_IDS = ['home-categories', 'home-featured', 'home-trust'] as const;

interface PlannedSection {
  id: string;
  sortOrder: number;
  type: SectionType;
  title: Prisma.InputJsonValue;
  config: Prisma.InputJsonValue;
}

/**
 * Copy carries the store name where naming it reads naturally, resolved for
 * each locale the store serves rather than stored as one string.
 */
function translatable(
  config: StoreRuntimeConfig,
  build: (storeName: string) => string,
): Prisma.InputJsonValue {
  const names = config.identity.storeName as Record<string, string>;
  const out: Record<string, string> = { default: build(names['default'] ?? '') };
  for (const locale of config.localization.supportedLocales) {
    out[locale] = build(names[locale] ?? names['default'] ?? '');
  }
  return out;
}

/** The most a showcase holds; the API DTO and both client schemas cap it here. */
const SHOWCASE_MAX_CATEGORIES = 12;
/** The most a featured rail holds, capped by the same three readers. */
const RAIL_MAX_PRODUCTS = 12;

function plan(
  config: StoreRuntimeConfig,
  categoryIds: string[],
  productIds: string[],
): PlannedSection[] {
  const categories = translatable(config, () => 'Shop by category');
  const featured = translatable(config, () => 'Popular right now');
  const trust = translatable(config, (store) => (store ? `Why ${store}` : 'Why shop with us'));
  // Every reader of the row requires at least one id and none falls back to
  // all categories, so a store with no categories yet gets no showcase.
  const showcase: PlannedSection[] =
    categoryIds.length === 0
      ? []
      : [
          {
            id: 'home-categories',
            sortOrder: 0,
            type: SectionType.CATEGORY_SHOWCASE,
            title: categories,
            config: { categoryIds, heading: categories },
          },
        ];
  // The same holds for the rail: no featured product, no rail.
  const rail: PlannedSection[] =
    productIds.length === 0
      ? []
      : [
          {
            id: 'home-featured',
            sortOrder: 1,
            type: SectionType.FEATURED_PRODUCTS,
            title: featured,
            config: { productIds, variant: 'grid', heading: featured },
          },
        ];
  return [
    ...showcase,
    ...rail,
    {
      id: 'home-trust',
      sortOrder: 2,
      type: SectionType.TRUST_SIGNALS,
      title: trust,
      config: {
        items: [
          {
            kind: 'delivery',
            title: translatable(config, () => 'Delivery'),
            subtitle: translatable(config, () => 'Tracked on every order'),
          },
          {
            kind: 'returns',
            title: translatable(config, () => 'Returns'),
            subtitle: translatable(config, () => '14 days'),
          },
          {
            kind: 'authentic',
            title: translatable(config, () => 'Genuine products'),
            subtitle: translatable(config, () => 'Manufacturer warranty'),
          },
          {
            kind: 'support',
            title: translatable(config, () => 'Support'),
            subtitle: translatable(config, () => 'Real people, fast replies'),
          },
        ],
      },
    },
  ];
}

/**
 * Plant the default home sections, or leave the page alone when the store
 * already has one.
 *
 * A store with any live `pageSlug='home'` row has a home page somebody chose,
 * whether the operator built it or the fixture catalogue planted it. Writing
 * defaults over that would fight both.
 */
export async function seedDefaultHomeSections(
  prisma: PrismaClient,
  config: StoreRuntimeConfig,
): Promise<{ planted: number; skipped: boolean }> {
  const existing = await prisma.storefrontSection.findFirst({
    where: { pageSlug: 'home', deletedAt: null, id: { notIn: [...DEFAULT_HOME_SECTION_IDS] } },
    select: { id: true },
  });
  if (existing) return { planted: 0, skipped: true };

  const topLevel = await prisma.category.findMany({
    where: { parentId: null, isVisible: true, deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    take: SHOWCASE_MAX_CATEGORIES,
    select: { id: true },
  });
  const featured = await prisma.product.findMany({
    where: { isFeatured: true, status: 'ACTIVE', deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    take: RAIL_MAX_PRODUCTS,
    select: { id: true },
  });
  const sections = plan(
    config,
    topLevel.map((c) => c.id),
    featured.map((p) => p.id),
  );
  for (const section of sections) {
    const data = {
      pageSlug: 'home',
      type: section.type,
      title: section.title,
      config: section.config,
      sortOrder: section.sortOrder,
      isVisible: true,
      deletedAt: null,
    };
    await prisma.storefrontSection.upsert({
      where: { id: section.id },
      update: data,
      create: { id: section.id, ...data },
    });
  }
  return { planted: sections.length, skipped: false };
}
