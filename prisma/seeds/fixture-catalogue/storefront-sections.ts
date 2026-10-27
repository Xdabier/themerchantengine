import * as fs from 'fs/promises';
import type { PrismaClient } from '@prisma/client';
import { Prisma, SectionType } from '@prisma/client';
import { ingestImage } from './lib/image-pipeline';
import type { SeedStorageDriver } from './lib/storage';
import { FIXTURE_CATALOGUE_PREFIXES } from './lib/idempotency';
import { HERO_BANNER_PATH, PROMO_BANNER_PATH } from './lib/seed-images';

export interface StorefrontSectionsSeedSummary {
  sections: number;
}

/**
 * Plants the five surviving DR-05 home sections for fixture catalogue. Idempotent —
 * every `pageSlug='home'` section is removed before recreation, so re-runs
 * yield the same end-state.
 *
 * The HERO + PROMOTIONAL_BANNER sections reference fresh `Asset` rows
 * ingested via `ingestImage` (content-hash storagePath under
 * `FIXTURE_CATALOGUE_ASSET_PREFIX`) — re-uses the same source binaries the legacy
 * banner seed uploads to `StoreSetting`. The CATEGORY_SHOWCASE +
 * FEATURED_PRODUCTS sections reference existing catalogue-scoped category /
 * product IDs queried at seed time.
 *
 * Read by `GET /v1/storefront/sections/home` once the
 * `STOREFRONT_DYNAMIC_SECTIONS=1` flag flips on (S20.4 / S21 cutover).
 */
export async function seedStorefrontSections(args: {
  prisma: PrismaClient;
  storage: SeedStorageDriver;
  log?: (msg: string) => void;
}): Promise<StorefrontSectionsSeedSummary> {
  const log = args.log ?? ((m: string) => console.log(`  [sections] ${m}`));

  // Idempotency: drop every existing 'home' section so re-runs yield identity.
  // Hard-delete via raw DELETE so the soft-delete middleware does not flip
  // these rows to `deletedAt: <now>` and leave them surface-able by any code
  // path that bypasses the middleware (e.g. raw SQL, SSR cache, or the
  // storefront sections endpoint when the middleware misses a model). The
  // S21 e2e regression caught this — soft-deleted prior seed rows resurfaced
  // alongside the active fixture catalogue rows and tripped Playwright strict-mode
  // testid lookups. The raw DELETE keeps the seed deterministic across
  // re-runs without depending on middleware semantics.
  const cleared = await args.prisma
    .$executeRaw`DELETE FROM "StorefrontSection" WHERE "pageSlug" = 'home'`;
  log(`cleared ${cleared} existing home sections`);

  // 1. Upload HERO + PROMOTIONAL_BANNER assets (idempotent via content hash).
  const heroSourcePath = HERO_BANNER_PATH;
  const promoSourcePath = PROMO_BANNER_PATH;

  const [heroExists, promoExists] = await Promise.all([
    fs
      .stat(heroSourcePath)
      .then(() => true)
      .catch(() => false),
    fs
      .stat(promoSourcePath)
      .then(() => true)
      .catch(() => false),
  ]);
  if (!heroExists || !promoExists) {
    log(`missing source banner — hero=${heroExists} promo=${promoExists}; skipping seed`);
    return { sections: 0 };
  }

  // Sequential, not `Promise.all`: `ingestImage` finds an existing asset by
  // content hash and creates one when it misses, and two concurrent misses race
  // into a unique-constraint violation on the second insert.
  const hero = await ingestImage({
    prisma: args.prisma,
    storage: args.storage,
    sourcePath: heroSourcePath,
    alt: {
      default: 'Storefront hero banner',
      en: 'Storefront hero banner',
      fr: 'Bannière principale de la boutique',
    },
  });
  const promo = await ingestImage({
    prisma: args.prisma,
    storage: args.storage,
    sourcePath: promoSourcePath,
    alt: {
      default: 'Promotional banner',
      en: 'Promotional banner',
      fr: 'Bannière promotionnelle',
    },
  });

  // 2. Fetch live fixture catalogue category + product IDs for the showcase + featured rails.
  const [categories, featuredProducts] = await Promise.all([
    args.prisma.category.findMany({
      where: { slug: { startsWith: FIXTURE_CATALOGUE_PREFIXES.slug }, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
      take: 6,
    }),
    args.prisma.product.findMany({
      where: {
        slug: { startsWith: FIXTURE_CATALOGUE_PREFIXES.slug },
        deletedAt: null,
        isFeatured: true,
      },
      select: { id: true },
      take: 8,
    }),
  ]);

  if (categories.length === 0 || featuredProducts.length === 0) {
    log(
      `insufficient catalog — categories=${categories.length} featured=${featuredProducts.length}; skipping`,
    );
    return { sections: 0 };
  }

  // 3. Plant the five sections in render order.
  const planted: { sortOrder: number; type: SectionType; config: object; title?: object }[] = [
    {
      sortOrder: 0,
      type: SectionType.HERO,
      title: {
        default: 'Welcome to Northwind',
        en: 'Welcome to Northwind',
        fr: 'Bienvenue chez Northwind',
      },
      config: {
        assetId: hero.assetId,
        eyebrow: { default: 'Launch campaign', en: 'Launch campaign', fr: 'Campagne de lancement' },
        headline: {
          default: 'Trusted quality, delivered',
          en: 'Trusted quality, delivered',
          fr: 'Une qualité fiable, livrée',
        },
        body: {
          default:
            'A curated selection of electronics, audio, and daily-care, with clear prices and fast delivery.',
          en: 'A curated selection of electronics, audio, and daily-care, with clear prices and fast delivery.',
          fr: 'Une sélection en électronique, audio et soins du quotidien, avec des prix clairs et une livraison rapide.',
        },
        cta: { default: 'Shop now', en: 'Shop now', fr: 'Acheter maintenant' },
        ctaHref: '/catalog',
        imageAlt: {
          default: 'A warm Northwind delivery moment',
          en: 'A warm Northwind delivery moment',
          fr: 'Un moment de livraison chaleureux chez Northwind',
        },
      },
    },
    {
      sortOrder: 1,
      type: SectionType.CATEGORY_SHOWCASE,
      title: {
        default: 'Shop by category',
        en: 'Shop by category',
        fr: 'Acheter par catégorie',
      },
      config: {
        categoryIds: categories.map((c) => c.id),
        heading: {
          default: 'Shop by category',
          en: 'Shop by category',
          fr: 'Acheter par catégorie',
        },
      },
    },
    {
      sortOrder: 2,
      type: SectionType.FEATURED_PRODUCTS,
      title: {
        default: 'Popular right now',
        en: 'Popular right now',
        fr: 'Populaire en ce moment',
      },
      config: {
        productIds: featuredProducts.map((p) => p.id),
        variant: 'grid',
        heading: {
          default: 'Popular right now',
          en: 'Popular right now',
          fr: 'Populaire en ce moment',
        },
      },
    },
    {
      sortOrder: 3,
      type: SectionType.TRUST_SIGNALS,
      title: { default: 'Why Northwind', en: 'Why Northwind', fr: 'Pourquoi Northwind' },
      config: {
        items: [
          {
            kind: 'delivery',
            title: { default: 'Fast delivery', en: 'Fast delivery', fr: 'Livraison rapide' },
            subtitle: {
              default: '24 to 48 hours',
              en: '24 to 48 hours',
              fr: '24 à 48 heures',
            },
          },
          {
            kind: 'returns',
            title: { default: 'Easy returns', en: 'Easy returns', fr: 'Retours simples' },
            subtitle: {
              default: '14 days, no questions',
              en: '14 days, no questions',
              fr: '14 jours, sans justification',
            },
          },
          {
            kind: 'authentic',
            title: {
              default: 'Authentic products',
              en: 'Authentic products',
              fr: 'Produits authentiques',
            },
            subtitle: {
              default: 'Regional warranty included',
              en: 'Regional warranty included',
              fr: 'Garantie régionale incluse',
            },
          },
          {
            kind: 'support',
            title: {
              default: 'Local support',
              en: 'Local support',
              fr: 'Assistance locale',
            },
            subtitle: {
              default: 'Arabic-first service team',
              en: 'Arabic-first service team',
              fr: 'Équipe de service arabophone',
            },
          },
        ],
      },
    },
    {
      sortOrder: 4,
      type: SectionType.PROMOTIONAL_BANNER,
      title: {
        default: 'Family season',
        en: 'Family season',
        fr: 'Saison famille',
      },
      config: {
        assetId: promo.assetId,
        eyebrow: { default: 'Family season', en: 'Family season', fr: 'Saison famille' },
        headline: {
          default: 'Everything your home needs',
          en: 'Everything your home needs',
          fr: 'Tout ce dont votre maison a besoin',
        },
        body: {
          default: 'Home sets and daily essentials, delivered to your door with quiet confidence.',
          en: 'Home sets and daily essentials, delivered to your door with quiet confidence.',
          fr: 'Ensembles pour la maison et essentiels du quotidien, livrés à votre porte en toute confiance.',
        },
        cta: {
          default: 'Discover the collection',
          en: 'Discover the collection',
          fr: 'Découvrir la collection',
        },
        ctaHref: '/catalog',
        imageAlt: {
          default: 'A package being received at the door',
          en: 'A package being received at the door',
          fr: 'Un colis réceptionné sur le pas de la porte',
        },
      },
    },
  ];

  await args.prisma.$transaction(
    planted.map((row) =>
      args.prisma.storefrontSection.create({
        data: {
          pageSlug: 'home',
          type: row.type,
          title: row.title as Prisma.InputJsonValue,
          config: row.config as Prisma.InputJsonValue,
          sortOrder: row.sortOrder,
          isVisible: true,
        },
      }),
    ),
  );

  log(`planted ${planted.length} home sections`);
  return { sections: planted.length };
}
