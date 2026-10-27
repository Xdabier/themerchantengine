import type { Prisma, PrismaClient } from '@prisma/client';
import { ingestImage } from './lib/image-pipeline';
import { resolveSeedStorageDriver, type SeedStorageDriver } from './lib/storage';
import { localized, type Translatable } from './lib/translatable';
import { seedImagePath } from './lib/seed-images';

export interface CategorySeed {
  slug: string;
  name: Translatable;
  description: Translatable;
  metaTitle: Translatable;
  metaDescription: Translatable;
  /** Stitch folder name to source the category hero image from. */
  heroSource: string;
  sortOrder: number;
}

export interface SubcategorySeed {
  slug: string;
  /** Parent slug — must match an entry in `FIXTURE_CATALOGUE_CATEGORIES`. */
  parentSlug: string;
  name: Translatable;
  description: Translatable;
  metaTitle: Translatable;
  metaDescription: Translatable;
  sortOrder: number;
  /** Optional. When omitted the subcategory inherits the parent's hero image. */
  heroSource?: string;
}

export const FIXTURE_CATALOGUE_CATEGORIES: CategorySeed[] = [
  {
    slug: 'fx-electronics',
    sortOrder: 0,
    name: localized({ en: 'Electronics', fr: 'Électronique', ar: 'إلكترونيات' }),
    description: localized({
      en: 'Laptops, accessories, and connected gear chosen for everyday households.',
      fr: 'Ordinateurs portables, accessoires et objets connectés choisis pour le quotidien des foyers.',
      ar: 'حواسيب محمولة وملحقات وأجهزة متصلة مختارة للاستخدام اليومي في المنازل.',
    }),
    metaTitle: localized({
      en: 'Electronics — Northwind',
      fr: 'Électronique, Northwind',
      ar: 'إلكترونيات، Northwind',
    }),
    metaDescription: localized({
      en: 'Discover the latest electronics with fast nationwide shipping and trusted COD.',
      fr: 'Les dernières nouveautés électroniques, livraison rapide et paiement à la livraison.',
      ar: 'اكتشف أحدث الإلكترونيات مع شحن سريع إلى كل البلاد والدفع عند الاستلام.',
    }),
    heroSource: 'sleek_business_laptop_open_and_showing_a_clean_interface_high_quality_product',
  },
  {
    slug: 'fx-audio',
    sortOrder: 1,
    name: localized({ en: 'Audio', fr: 'Audio', ar: 'صوتيات' }),
    description: localized({
      en: 'Headphones and listening gear tuned for clear, immersive sound at home or on the go.',
      fr: 'Casques et matériel audio réglés pour un son net et immersif, à la maison comme en déplacement.',
      ar: 'سماعات ومعدات استماع مضبوطة لصوت نقي ومحيط في المنزل أو أثناء التنقل.',
    }),
    metaTitle: localized({
      en: 'Audio — Northwind',
      fr: 'Audio, Northwind',
      ar: 'صوتيات، Northwind',
    }),
    metaDescription: localized({
      en: 'Premium headphones, earbuds, and speakers shipped fast.',
      fr: 'Casques, écouteurs et enceintes haut de gamme, expédiés rapidement.',
      ar: 'سماعات رأس وسماعات أذن ومكبرات صوت فاخرة تُشحن بسرعة.',
    }),
    heroSource: 'professional_studio_headphones_classic_design_with_silver_accents_high_quality',
  },
  {
    slug: 'fx-wearables',
    sortOrder: 2,
    name: localized({ en: 'Wearables', fr: 'Objets connectés', ar: 'أجهزة قابلة للارتداء' }),
    description: localized({
      en: 'Smart watches and fitness trackers that fit your day and your wrist.',
      fr: 'Montres connectées et bracelets de suivi qui accompagnent votre journée et votre poignet.',
      ar: 'ساعات ذكية وأساور لياقة تناسب يومك ومعصمك.',
    }),
    metaTitle: localized({
      en: 'Wearables — Northwind',
      fr: 'Objets connectés, Northwind',
      ar: 'أجهزة قابلة للارتداء، Northwind',
    }),
    metaDescription: localized({
      en: 'Smart watches and fitness trackers with multilingual interfaces and everyday support.',
      fr: 'Montres connectées et bracelets de suivi avec interface arabe complète et assistance locale.',
      ar: 'ساعات ذكية وأساور لياقة بواجهات متعددة اللغات ودعم يومي.',
    }),
    heroSource: 'premium_smart_watch_with_a_minimalist_black_face_and_silicone_strap_high',
  },
  {
    slug: 'fx-home-essentials',
    sortOrder: 3,
    name: localized({ en: 'Home Essentials', fr: 'Essentiels maison', ar: 'أساسيات المنزل' }),
    description: localized({
      en: 'Smart hubs, hydration, and quiet upgrades for the modern home.',
      fr: 'Centrales connectées, gourdes et petits équipements discrets pour la maison moderne.',
      ar: 'مراكز ذكية وزجاجات مياه وتحسينات هادئة للمنزل العصري.',
    }),
    metaTitle: localized({
      en: 'Home Essentials — Northwind',
      fr: 'Essentiels maison, Northwind',
      ar: 'أساسيات المنزل، Northwind',
    }),
    metaDescription: localized({
      en: 'Practical, well-built home essentials curated for everyday use.',
      fr: 'Des essentiels maison pratiques et bien construits, choisis pour un usage quotidien.',
      ar: 'أساسيات منزلية عملية ومتقنة الصنع مختارة للاستخدام اليومي.',
    }),
    heroSource: 'sleek_smart_home_hub_device_with_a_minimal_screen_and_fabric_finish_high',
  },
  {
    slug: 'fx-personal-care',
    sortOrder: 4,
    name: localized({ en: 'Personal Care', fr: 'Soins personnels', ar: 'العناية الشخصية' }),
    description: localized({
      en: 'Skincare and grooming sets for every skin type.',
      fr: 'Coffrets de soin du visage et du corps pour tous les types de peau.',
      ar: 'مجموعات للعناية بالبشرة والمظهر لكل أنواع البشرة.',
    }),
    metaTitle: localized({
      en: 'Personal Care — Northwind',
      fr: 'Soins personnels, Northwind',
      ar: 'العناية الشخصية، Northwind',
    }),
    metaDescription: localized({
      en: 'Skincare sets, grooming, and daily-care picks shipped quickly.',
      fr: 'Coffrets de soin et produits du quotidien expédiés rapidement.',
      ar: 'مجموعات العناية بالبشرة ومنتجات العناية اليومية تُشحن بسرعة.',
    }),
    heroSource: 'set_of_premium_skincare_products_minimalist_glass_bottles_and_jars_high_quality',
  },
];

/**
 * Subcategories under the visible fixture-catalogue tree. Each entry has a
 * `parentSlug` pointing at one of `FIXTURE_CATALOGUE_CATEGORIES` above; the seeder
 * resolves the parent id at create time. Hero images are inherited from
 * the parent — subcategories don't need their own hero today.
 */
export const FIXTURE_CATALOGUE_SUBCATEGORIES: SubcategorySeed[] = [
  {
    slug: 'fx-pro-headphones',
    parentSlug: 'fx-audio',
    sortOrder: 0,
    name: localized({ en: 'Pro Headphones', fr: 'Casques professionnels', ar: 'سماعات احترافية' }),
    description: localized({
      en: 'Studio-grade headphones for honest, reference-quality sound.',
      fr: 'Casques de qualité studio pour un son fidèle, de niveau référence.',
      ar: 'سماعات بجودة الاستوديو لصوت صادق بمستوى مرجعي.',
    }),
    metaTitle: localized({
      en: 'Pro Headphones — Northwind',
      fr: 'Casques professionnels, Northwind',
      ar: 'سماعات احترافية، Northwind',
    }),
    metaDescription: localized({
      en: 'Reference studio headphones tuned for clear, accurate sound.',
      fr: 'Casques de studio de référence, réglés pour un son net et précis.',
      ar: 'سماعات استوديو مرجعية مضبوطة لصوت نقي ودقيق.',
    }),
  },
  {
    slug: 'fx-wireless-headphones',
    parentSlug: 'fx-audio',
    sortOrder: 1,
    name: localized({ en: 'Wireless Headphones', fr: 'Casques sans fil', ar: 'سماعات لاسلكية' }),
    description: localized({
      en: 'Cable-free over-ear headphones with all-day battery and active noise cancellation.',
      fr: 'Casques circum-auriculaires sans fil, autonomie sur la journée et réduction de bruit active.',
      ar: 'سماعات لاسلكية تغطي الأذن مع بطارية تدوم طوال اليوم وعزل نشط للضوضاء.',
    }),
    metaTitle: localized({
      en: 'Wireless Headphones — Northwind',
      fr: 'Casques sans fil, Northwind',
      ar: 'سماعات لاسلكية، Northwind',
    }),
    metaDescription: localized({
      en: 'Wireless over-ear headphones with active noise cancellation.',
      fr: 'Casques circum-auriculaires sans fil avec réduction de bruit active.',
      ar: 'سماعات لاسلكية تغطي الأذن مع عزل نشط للضوضاء.',
    }),
  },
  {
    slug: 'fx-smart-watches',
    parentSlug: 'fx-wearables',
    sortOrder: 0,
    name: localized({ en: 'Smart Watches', fr: 'Montres connectées', ar: 'ساعات ذكية' }),
    description: localized({
      en: 'Connected watches with a multilingual interface and everyday support.',
      fr: 'Montres connectées avec interface en arabe et assistance locale.',
      ar: 'ساعات متصلة بواجهة متعددة اللغات ودعم يومي.',
    }),
    metaTitle: localized({
      en: 'Smart Watches — Northwind',
      fr: 'Montres connectées, Northwind',
      ar: 'ساعات ذكية، Northwind',
    }),
    metaDescription: localized({
      en: 'Smart watches with multilingual interfaces.',
      fr: 'Montres connectées avec interface arabe complète.',
      ar: 'ساعات ذكية بواجهات متعددة اللغات.',
    }),
  },
  {
    slug: 'fx-fitness-trackers',
    parentSlug: 'fx-wearables',
    sortOrder: 1,
    name: localized({ en: 'Fitness Trackers', fr: 'Bracelets de suivi', ar: 'أساور اللياقة' }),
    description: localized({
      en: 'Lightweight fitness bands tuned for daily activity tracking.',
      fr: "Bracelets légers réglés pour le suivi de l'activité au quotidien.",
      ar: 'أساور لياقة خفيفة مضبوطة لتتبع النشاط اليومي.',
    }),
    metaTitle: localized({
      en: 'Fitness Trackers — Northwind',
      fr: 'Bracelets de suivi, Northwind',
      ar: 'أساور اللياقة، Northwind',
    }),
    metaDescription: localized({
      en: 'Daily-wear fitness trackers with multi-day battery life.',
      fr: 'Bracelets de suivi portés au quotidien, autonomie de plusieurs jours.',
      ar: 'أساور لياقة للاستخدام اليومي مع بطارية تدوم عدة أيام.',
    }),
  },
  {
    slug: 'fx-smart-home',
    parentSlug: 'fx-home-essentials',
    sortOrder: 0,
    name: localized({ en: 'Smart Home', fr: 'Maison connectée', ar: 'المنزل الذكي' }),
    description: localized({
      en: 'Hubs and connected gear for the modern home.',
      fr: 'Centrales et appareils connectés pour la maison moderne.',
      ar: 'مراكز وأجهزة متصلة للمنزل العصري.',
    }),
    metaTitle: localized({
      en: 'Smart Home — Northwind',
      fr: 'Maison connectée, Northwind',
      ar: 'المنزل الذكي، Northwind',
    }),
    metaDescription: localized({
      en: 'Smart home hubs and connected gear shipped fast.',
      fr: 'Centrales domotiques et appareils connectés expédiés rapidement.',
      ar: 'مراكز المنزل الذكي والأجهزة المتصلة تُشحن بسرعة.',
    }),
  },
  {
    slug: 'fx-hydration',
    parentSlug: 'fx-home-essentials',
    sortOrder: 1,
    name: localized({ en: 'Hydration', fr: 'Hydratation', ar: 'الترطيب' }),
    description: localized({
      en: 'Insulated bottles and hydration gear for daily life climate.',
      fr: 'Gourdes isothermes et accessoires pour boire au quotidien sous le climat.',
      ar: 'زجاجات معزولة ومستلزمات شرب للحياة اليومية.',
    }),
    metaTitle: localized({
      en: 'Hydration — Northwind',
      fr: 'Hydratation, Northwind',
      ar: 'الترطيب، Northwind',
    }),
    metaDescription: localized({
      en: 'Insulated bottles tuned for everyday use.',
      fr: 'Gourdes isothermes pensées pour un usage quotidien.',
      ar: 'زجاجات معزولة مناسبة للاستخدام اليومي.',
    }),
  },
];

export interface SeededCategory {
  id: string;
  slug: string;
  imageId: string | null;
  parentId?: string | null;
}

export async function seedCategories(args: {
  prisma: PrismaClient;
  storage?: SeedStorageDriver;
}): Promise<SeededCategory[]> {
  const storage = args.storage ?? resolveSeedStorageDriver();
  const out: SeededCategory[] = [];

  for (const cat of FIXTURE_CATALOGUE_CATEGORIES) {
    const heroPath = seedImagePath(cat.heroSource);
    let imageId: string | null = null;
    try {
      const ingested = await ingestImage({
        prisma: args.prisma,
        storage,
        sourcePath: heroPath,
        alt: cat.name,
      });
      imageId = ingested.assetId;
    } catch (err) {
      // Surface but do not abort — the category can render without a hero
      // image; the storefront category card has a placeholder fallback.
      console.warn(
        ` [fixture-catalogue] missing category hero ${cat.slug} (${heroPath}): ${(err as Error).message}`,
      );
    }

    const created = await args.prisma.category.create({
      data: {
        name: cat.name satisfies Prisma.InputJsonValue,
        slug: cat.slug,
        description: cat.description satisfies Prisma.InputJsonValue,
        metaTitle: cat.metaTitle satisfies Prisma.InputJsonValue,
        metaDescription: cat.metaDescription satisfies Prisma.InputJsonValue,
        sortOrder: cat.sortOrder,
        isVisible: true,
        depth: 0,
        path: '/',
        imageId,
      },
    });

    // Update the materialized path now that we know the assigned id.
    await args.prisma.category.update({
      where: { id: created.id },
      data: { path: `/${created.id}` },
    });

    out.push({ id: created.id, slug: created.slug, imageId, parentId: null });
  }

  // Subcategories — parent must already exist in `out`. Each child inherits
  // the parent's hero image when the seed entry doesn't specify its own.
  for (const sub of FIXTURE_CATALOGUE_SUBCATEGORIES) {
    const parent = out.find((c) => c.slug === sub.parentSlug);
    if (!parent) {
      throw new Error(`Subcategory ${sub.slug} references unknown parent ${sub.parentSlug}`);
    }
    let imageId: string | null = parent.imageId;
    if (sub.heroSource) {
      const heroPath = seedImagePath(sub.heroSource);
      try {
        const ingested = await ingestImage({
          prisma: args.prisma,
          storage,
          sourcePath: heroPath,
          alt: sub.name,
        });
        imageId = ingested.assetId;
      } catch (err) {
        console.warn(
          ` [fixture-catalogue] missing subcategory hero ${sub.slug} (${heroPath}): ${(err as Error).message}`,
        );
      }
    }
    const created = await args.prisma.category.create({
      data: {
        name: sub.name satisfies Prisma.InputJsonValue,
        slug: sub.slug,
        description: sub.description satisfies Prisma.InputJsonValue,
        metaTitle: sub.metaTitle satisfies Prisma.InputJsonValue,
        metaDescription: sub.metaDescription satisfies Prisma.InputJsonValue,
        sortOrder: sub.sortOrder,
        isVisible: true,
        depth: 1,
        parentId: parent.id,
        path: `/${parent.id}`,
        imageId,
      },
    });
    await args.prisma.category.update({
      where: { id: created.id },
      data: { path: `/${parent.id}/${created.id}` },
    });
    out.push({ id: created.id, slug: created.slug, imageId, parentId: parent.id });
  }

  return out;
}
