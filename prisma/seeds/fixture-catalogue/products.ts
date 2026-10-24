import type { Prisma, PrismaClient } from '@prisma/client';
import { ProductStatus } from '@prisma/client';
import { ingestImage } from './lib/image-pipeline';
import { resolveSeedStorageDriver, type SeedStorageDriver } from './lib/storage';
import { localized, type Translatable } from './lib/translatable';
import type { SeededCategory } from './categories';
import { seedImagePath } from './lib/seed-images';

/** Tiles to walk when filling a short gallery, bounded so the loop always ends. */
const TILE_FILL_ATTEMPTS = 8;

/**
 * Image source family. Each entry references a folder name on disk; the seed
 * walks the candidate roots (stitch_component_library_forms_checkout/, then
 * new/) to locate the matching folder. Missing folders are filled with the
 * hero so every product carries 3 images (clarifications §1.5 fall-back).
 */
interface ImageFamily {
  hero: string;
  gallery: string[];
}

/**
 * The image a product family seeds with. The `folder` name is what the family
 * was originally photographed under; it is now only a key, and the picture
 * ships inside the seed directory (plan E2.6).
 */
function resolveFamilySource(folder: string): string {
  return seedImagePath(folder);
}

const FAMILIES: Record<string, ImageFamily> = {
  laptop: {
    hero: 'sleek_business_laptop_open_and_showing_a_clean_interface_high_quality_product',
    gallery: [
      'a_variation_of_the_business_laptop_high_quality_product_photography_centered_1',
      'a_second_variation_of_the_business_laptop_high_quality_product_photography',
      // new/ variations
      'sleek_modern_laptop_on_a_clean_sand_textured_surface_high_quality_product_1',
      'sleek_modern_laptop_on_a_clean_sand_textured_surface_high_quality_product_2',
      'close_up_of_a_sleek_modern_laptop_keyboard_and_screen_displaying_an_abstract',
    ],
  },
  proHeadphones: {
    hero: 'professional_studio_headphones_classic_design_with_silver_accents_high_quality',
    gallery: [
      'a_variation_of_the_professional_headphones_high_quality_product_photography',
      'a_second_variation_of_the_professional_headphones_high_quality_product',
    ],
  },
  wirelessHeadphones: {
    hero: 'wireless_noise_canceling_over_ear_headphones_sleek_matte_black_finish_high',
    gallery: [
      'a_variation_of_the_wireless_headphones_high_quality_product_photography',
      'a_second_variation_of_the_wireless_headphones_high_quality_product_photography',
    ],
  },
  smartWatch: {
    hero: 'premium_smart_watch_with_a_minimalist_black_face_and_silicone_strap_high',
    gallery: [
      'a_variation_of_the_premium_smart_watch_high_quality_product_photography',
      'a_second_variation_of_the_premium_smart_watch_high_quality_product_photography',
    ],
  },
  fitnessTracker: {
    hero: 'modern_fitness_tracker_with_a_slim_black_band_high_quality_product_photography',
    gallery: [
      'a_variation_of_the_fitness_tracker_high_quality_product_photography_centered_1',
      'a_second_variation_of_the_fitness_tracker_high_quality_product_photography',
    ],
  },
  waterBottle: {
    hero: 'modern_designer_glass_water_bottle_with_a_textured_black_silicone_sleeve_high',
    gallery: [
      'a_variation_of_the_glass_water_bottle_high_quality_product_photography_centered',
      'a_second_variation_of_the_glass_water_bottle_high_quality_product_photography',
      // new/ variations
      'designer_glass_water_bottle_with_a_textured_black_sleeve_high_quality_product_1',
      'designer_glass_water_bottle_with_a_textured_black_sleeve_high_quality_product_2',
      'designer_glass_water_bottle_with_a_textured_black_sleeve_high_quality_product_3',
    ],
  },
  smartHomeHub: {
    hero: 'sleek_smart_home_hub_device_with_a_minimal_screen_and_fabric_finish_high',
    gallery: [
      'a_variation_of_the_smart_home_hub_high_quality_product_photography_centered_1_1',
      'a_second_variation_of_the_smart_home_hub_high_quality_product_photography',
    ],
  },
  skincare: {
    hero: 'set_of_premium_skincare_products_minimalist_glass_bottles_and_jars_high_quality',
    gallery: [
      'a_variation_of_the_skincare_set_high_quality_product_photography_centered_1_1',
      'a_second_variation_of_the_skincare_set_high_quality_product_photography',
      // new/ variations
      'luxury_skincare_set_with_frosted_glass_bottles_and_gold_accents_high_quality_1',
      'luxury_skincare_set_with_frosted_glass_bottles_and_gold_accents_high_quality_2',
      'luxury_skincare_set_with_frosted_glass_bottles_and_gold_accents_high_quality_3',
    ],
  },
};

interface ProductRow {
  slug: string;
  name: Translatable;
  shortDescription: Translatable;
  description: Translatable;
  metaTitle: Translatable;
  metaDescription: Translatable;
  family: keyof typeof FAMILIES;
  /** Category slug from `categories.ts`. */
  categorySlug: string;
  /**
   * Optional subcategory slug from `FIXTURE_CATALOGUE_SUBCATEGORIES`. When set, the
   * product gets junction rows for BOTH the parent and the subcategory so
   * /catalog/{parent} keeps showing the full mix while /catalog/{sub}
   * filters to just the subset.
   */
  subCategorySlug?: string;
  /** Base price, in the store currency. */
  price: number;
  /** Optional MSRP / strike-through price. */
  compareAtPrice?: number;
  sku: string;
  isFeatured: boolean;
  tags: string[];
  /** Stock-band: 'in' | 'low' | 'oos'. Drives StockLevel.onHand in inventory module. */
  stockBand: 'in' | 'low' | 'oos';
  /**
   * Free-text `Product.brand`, surfaced by `GET /v1/products/brands` and the
   * storefront brand facet. Only the audio family carries one, split across
   * its two sub-families, so the facet has more than one row to narrow
   * between: a single brand across the whole catalogue could never fail the
   * regression `catalog-facets.journey.spec.ts` guards against (a filtered
   * catalogue equal to the unfiltered one). Every other product leaves this
   * unset; the storefront rail already hides the facet at zero brands.
   */
  brand?: string;
}

/**
 * 36 products distributed: Electronics 8, Audio 8, Wearables 8,
 * Home Essentials 6, Personal Care 6. pricing across 4 bands per
 * plan task 3. Stock seeded mostly in-stock with 3 low-stock + 1 OOS
 * to exercise storefront state UI.
 */
/**
 * The one catalogue row that is seeded with no picture, deliberately.
 *
 * `test/e2e/wishlist.e2e-spec.ts` asserts the wishlist read emits
 * `primaryAsset: null` rather than omitting the key for a product that has
 * none, and it finds its subject by asking the seed for an ACTIVE product with
 * no assets. Such a product used to exist by accident: every image path
 * resolved to a directory outside the repository, so on any machine but one the
 * ingest silently skipped and the whole catalogue was assetless. Now that the
 * pictures ship with the seed there would be none at all, and that spec would
 * fail in `beforeAll` for want of a subject rather than for a defect. Keeping
 * one costs a single card's thumbnail and lets the spec keep reading real seed
 * rows per constitution §3.8.
 */
export const ASSETLESS_PRODUCT_SLUG = 'fx-laptop-compact-12-se';

export const FIXTURE_CATALOGUE_PRODUCTS: ProductRow[] = [
  // ── Electronics × 8 (laptop family) ────────────────────────────────────────
  electronics(1, 'Pro 14 Standard', 2_499, 'FX-LAP-PRO14-STD', false, 'in'),
  electronics(2, 'Pro 14 Plus', 2_999, 'FX-LAP-PRO14-PLS', true, 'in', 3_299),
  electronics(3, 'Pro 16 Studio', 3_899, 'FX-LAP-PRO16-STD', true, 'in'),
  electronics(4, 'Pro 16 Max', 4_799, 'FX-LAP-PRO16-MAX', false, 'in', 4_999),
  electronics(5, 'Air 13 Light', 1_799, 'FX-LAP-AIR13-LGT', false, 'low'),
  electronics(6, 'Air 13 Edition', 1_999, 'FX-LAP-AIR13-ED', false, 'in'),
  electronics(7, 'Office 15 Workstation', 2_249, 'FX-LAP-OFC15-WS', false, 'in'),
  electronics(8, 'Compact 12 SE', 1_299, 'FX-LAP-CPT12-SE', false, 'in', 1_499),
  // ── Audio × 8 (4 pro + 4 wireless) ────────────────────────────────────────
  audio(1, 'Studio Reference', 'proHeadphones', 1_199, 'FX-AUD-PRO-REF', true, 'in'),
  audio(2, 'Studio Reference Pro', 'proHeadphones', 1_499, 'FX-AUD-PRO-REFPRO', false, 'in', 1_699),
  audio(3, 'Stage Monitor', 'proHeadphones', 999, 'FX-AUD-PRO-STG', false, 'in'),
  audio(4, 'Producer Edition', 'proHeadphones', 1_799, 'FX-AUD-PRO-PRD', false, 'low'),
  audio(5, 'Quiet Travel', 'wirelessHeadphones', 849, 'FX-AUD-WL-TRV', false, 'in', 999),
  audio(6, 'Quiet Travel Plus', 'wirelessHeadphones', 1_099, 'FX-AUD-WL-TRVP', true, 'in'),
  audio(7, 'Daily Commute', 'wirelessHeadphones', 549, 'FX-AUD-WL-CMT', false, 'in'),
  audio(8, 'Active Sport', 'wirelessHeadphones', 449, 'FX-AUD-WL-SPT', false, 'in'),
  // ── Wearables × 8 (4 watch + 4 tracker) ──────────────────────────────────
  wearable(1, 'Active Watch', 'smartWatch', 1_299, 'FX-WR-AW', false, 'in'),
  wearable(2, 'Active Watch Pro', 'smartWatch', 1_799, 'FX-WR-AWPRO', true, 'in', 1_999),
  wearable(3, 'Classic Edition', 'smartWatch', 999, 'FX-WR-CLE', false, 'in'),
  wearable(4, 'Sport SE', 'smartWatch', 749, 'FX-WR-SPS', false, 'low'),
  wearable(5, 'Pulse Tracker', 'fitnessTracker', 349, 'FX-WR-PLT', false, 'in'),
  wearable(6, 'Pulse Tracker Plus', 'fitnessTracker', 449, 'FX-WR-PLTP', false, 'in', 499),
  wearable(7, 'Step Lite', 'fitnessTracker', 249, 'FX-WR-STL', false, 'in'),
  wearable(8, 'Step SE', 'fitnessTracker', 199, 'FX-WR-STS', false, 'oos'),
  // ── Home Essentials × 6 (3 bottle + 3 hub) ────────────────────────────────
  home(1, 'Hydra Bottle 500', 'waterBottle', 89, 'FX-HM-HB500', false, 'in', 109),
  home(2, 'Hydra Bottle 750', 'waterBottle', 109, 'FX-HM-HB750', false, 'in'),
  home(3, 'Hydra Bottle Insulated', 'waterBottle', 149, 'FX-HM-HBI', false, 'in'),
  home(4, 'Smart Hub Mini', 'smartHomeHub', 449, 'FX-HM-SHM', true, 'in'),
  home(5, 'Smart Hub Plus', 'smartHomeHub', 599, 'FX-HM-SHP', false, 'in', 699),
  home(6, 'Smart Hub Display', 'smartHomeHub', 799, 'FX-HM-SHD', false, 'low'),
  // ── Personal Care × 6 (skincare set) ──────────────────────────────────────
  personal(
    1,
    'Daily Ritual Set',
    'Coffret Rituel Quotidien',
    'مجموعة الطقس اليومي',
    199,
    'FX-PC-DRS',
    true,
    'in',
    249,
  ),
  personal(2, 'Hydration Trio', 'Trio Hydratation', 'ثلاثي الترطيب', 159, 'FX-PC-HT', false, 'in'),
  personal(
    3,
    'Glow Routine Kit',
    'Kit Routine Éclat',
    'مجموعة روتين النضارة',
    229,
    'FX-PC-GRK',
    false,
    'in',
  ),
  personal(
    4,
    'Repair Night Set',
    'Coffret Nuit Réparateur',
    'مجموعة إصلاح الليل',
    189,
    'FX-PC-RNS',
    false,
    'in',
  ),
  personal(
    5,
    'Sun Care Bundle',
    'Coffret Protection Solaire',
    'حزمة الحماية من الشمس',
    139,
    'FX-PC-SCB',
    false,
    'in',
    169,
  ),
  personal(
    6,
    'Travel Essentials',
    'Essentiels Voyage',
    'أساسيات السفر',
    99,
    'FX-PC-TE',
    false,
    'in',
  ),
];

// ── Category-scoped builders ─────────────────────────────────────────────────

function electronics(
  index: number,
  model: string,
  price: number,
  sku: string,
  isFeatured: boolean,
  stockBand: ProductRow['stockBand'],
  compareAtPrice?: number,
): ProductRow {
  return {
    slug: `fx-laptop-${kebab(model)}`,
    name: localized({
      en: `Northwind ${model} Laptop`,
      fr: `Ordinateur portable Northwind ${model}`,
      ar: `حاسوب Northwind ${model} المحمول`,
    }),
    shortDescription: localized({
      en: `Lightweight ${model.toLowerCase()} laptop tuned for everyday work.`,
      fr: `Ordinateur portable ${model} léger, réglé pour le travail quotidien.`,
      ar: `حاسوب ${model} محمول خفيف مضبوط للعمل اليومي.`,
    }),
    description: localized({
      en: `Crafted for daily productivity: long battery life, a quiet keyboard, and a clear display tuned for bright daylight. The Northwind ${model} ships with a one-year warranty and a full keyboard.`,
      fr: `Conçu pour la productivité de tous les jours : longue autonomie, clavier silencieux et écran lisible en plein soleil. Le modèle Northwind ${model} est livré avec une garantie d'un an et un clavier complet.`,
      ar: `صُمم للإنتاجية اليومية: بطارية تدوم طويلاً ولوحة مفاتيح هادئة وشاشة واضحة تحت ضوء النهار الساطع. يأتي حاسوب Northwind ${model} مع ضمان لمدة عام ولوحة مفاتيح كاملة.`,
    }),
    metaTitle: localized({
      en: `Northwind ${model} Laptop`,
      fr: `Ordinateur portable Northwind ${model}`,
      ar: `حاسوب Northwind ${model} المحمول`,
    }),
    metaDescription: localized({
      en: `${model} laptop with a one-year warranty and a full keyboard, shipped fast.`,
      fr: `Ordinateur portable ${model} avec garantie d'un an et clavier complet, expédié rapidement.`,
      ar: `حاسوب ${model} محمول مع ضمان عام ولوحة مفاتيح كاملة، يُشحن بسرعة.`,
    }),
    family: 'laptop',
    categorySlug: 'fx-electronics',
    price,
    compareAtPrice,
    sku,
    isFeatured,
    tags: tagsFor(stockBand, isFeatured, ['laptop', 'electronics'], index),
    stockBand,
  };
}

function audio(
  index: number,
  model: string,
  family: 'proHeadphones' | 'wirelessHeadphones',
  price: number,
  sku: string,
  isFeatured: boolean,
  stockBand: ProductRow['stockBand'],
  compareAtPrice?: number,
): ProductRow {
  const isPro = family === 'proHeadphones';
  return {
    slug: `fx-${isPro ? 'pro' : 'wl'}-headphones-${kebab(model)}`,
    name: localized({
      en: `${model} ${isPro ? 'Studio Headphones' : 'Wireless Headphones'}`,
      fr: `Casque ${isPro ? 'studio' : 'sans fil'} ${model}`,
      ar: `${isPro ? 'سماعات استوديو' : 'سماعات لاسلكية'} ${model}`,
    }),
    shortDescription: localized({
      en: isPro
        ? `Reference-grade ${model.toLowerCase()} headphones for clear, honest sound.`
        : `Comfortable wireless ${model.toLowerCase()} headphones with all-day battery.`,
      fr: isPro
        ? `Casque ${model} de niveau référence, pour un son net et fidèle.`
        : `Casque sans fil ${model} confortable, avec une autonomie sur toute la journée.`,
      ar: isPro
        ? `سماعات ${model} بمستوى مرجعي لصوت نقي وصادق.`
        : `سماعات ${model} لاسلكية مريحة مع بطارية تدوم طوال اليوم.`,
    }),
    description: localized({
      en: isPro
        ? `Studio-tuned drivers, soft over-ear cups, and a detachable cable. Built for long sessions and tuned to give you the kind of detail that helps you trust what you hear.`
        : `Active noise cancellation, quick-charge battery, and travel-friendly fold. The ${model} keeps your day quiet without ever feeling heavy on your head.`,
      fr: isPro
        ? `Transducteurs calibrés en studio, coussinets souples et câble détachable. Pensé pour les longues sessions et réglé pour restituer le détail auquel vous pouvez vous fier.`
        : `Réduction de bruit active, batterie à charge rapide et pliage adapté au voyage. Le ${model} garde votre journée au calme sans jamais peser sur la tête.`,
      ar: isPro
        ? `مشغلات مضبوطة في الاستوديو ووسائد ناعمة تغطي الأذن وكابل قابل للفصل. مصممة للجلسات الطويلة ومضبوطة لتمنحك التفاصيل التي تجعلك تثق بما تسمع.`
        : `عزل نشط للضوضاء وبطارية سريعة الشحن وطي مناسب للسفر. يحافظ ${model} على هدوء يومك دون أن يثقل على رأسك.`,
    }),
    metaTitle: localized({
      en: `${model} ${isPro ? 'Studio Headphones' : 'Wireless Headphones'}`,
      fr: `Casque ${isPro ? 'studio' : 'sans fil'} ${model}`,
      ar: `${isPro ? 'سماعات استوديو' : 'سماعات لاسلكية'} ${model}`,
    }),
    metaDescription: localized({
      en: `${model} ${isPro ? 'studio' : 'wireless'} headphones, shipped fast, cash on delivery available.`,
      fr: `Casque ${isPro ? 'studio' : 'sans fil'} ${model}, expédition rapide et paiement à la livraison.`,
      ar: `${isPro ? 'سماعات استوديو' : 'سماعات لاسلكية'} ${model}، شحن سريع ودفع عند الاستلام.`,
    }),
    family,
    categorySlug: 'fx-audio',
    subCategorySlug: isPro ? 'fx-pro-headphones' : 'fx-wireless-headphones',
    price,
    compareAtPrice,
    sku,
    isFeatured,
    tags: tagsFor(
      stockBand,
      isFeatured,
      isPro ? ['headphones', 'studio'] : ['headphones', 'wireless'],
      index,
    ),
    stockBand,
    brand: isPro ? 'Northwind Studio' : 'Northwind Motion',
  };
}

function wearable(
  index: number,
  model: string,
  family: 'smartWatch' | 'fitnessTracker',
  price: number,
  sku: string,
  isFeatured: boolean,
  stockBand: ProductRow['stockBand'],
  compareAtPrice?: number,
): ProductRow {
  const isWatch = family === 'smartWatch';
  return {
    slug: `fx-${isWatch ? 'watch' : 'tracker'}-${kebab(model)}`,
    name: localized({
      en: `${model} ${isWatch ? 'Smart Watch' : 'Fitness Tracker'}`,
      fr: `${isWatch ? 'Montre connectée' : 'Bracelet de suivi'} ${model}`,
      ar: `${isWatch ? 'ساعة ذكية' : 'سوار لياقة'} ${model}`,
    }),
    shortDescription: localized({
      en: isWatch
        ? `Bilingual ${model.toLowerCase()} watch: calls, fitness, and a clear face.`
        : `Slim ${model.toLowerCase()} tracker that keeps an honest count of your day.`,
      fr: isWatch
        ? `Montre ${model} bilingue : appels, activité et cadran lisible.`
        : `Bracelet de suivi ${model} fin, qui compte votre journée sans rien exagérer.`,
      ar: isWatch
        ? `ساعة ${model} ثنائية اللغة: مكالمات ولياقة وشاشة واضحة.`
        : `سوار ${model} نحيف يحسب يومك بدقة دون مبالغة.`,
    }),
    description: localized({
      en: isWatch
        ? `A full-language UI, GPS, water resistance and a comfortable strap. Tuned for daylight readability.`
        : `Two-week battery, sleep tracking, and a slim band that disappears on your wrist. Tracks steps, heart rate, and active minutes without making a fuss.`,
      fr: isWatch
        ? `Interface complète, GPS, résistance à l'eau et bracelet confortable. Lisible en plein soleil.`
        : `Deux semaines d'autonomie, suivi du sommeil et bracelet fin qui se fait oublier au poignet. Compte les pas, la fréquence cardiaque et les minutes actives, sans bruit.`,
      ar: isWatch
        ? `واجهة كاملة اللغات ونظام تحديد المواقع ومقاومة للماء وسوار مريح. مضبوطة لتكون مقروءة تحت ضوء النهار.`
        : `بطارية تدوم أسبوعين وتتبع للنوم وسوار نحيف لا تكاد تشعر به على معصمك. يحسب الخطوات ونبض القلب والدقائق النشطة بهدوء.`,
    }),
    metaTitle: localized({
      en: `${model} ${isWatch ? 'Smart Watch' : 'Fitness Tracker'}`,
      fr: `${isWatch ? 'Montre connectée' : 'Bracelet de suivi'} ${model}`,
      ar: `${isWatch ? 'ساعة ذكية' : 'سوار لياقة'} ${model}`,
    }),
    metaDescription: localized({
      en: `${model} ${isWatch ? 'smart watch' : 'fitness tracker'} with a full-language UI, shipped fast.`,
      fr: `${isWatch ? 'Montre connectée' : 'Bracelet de suivi'} ${model} à interface complète, expédition rapide.`,
      ar: `${isWatch ? 'ساعة ذكية' : 'سوار لياقة'} ${model} بواجهة كاملة اللغات، شحن سريع.`,
    }),
    family,
    categorySlug: 'fx-wearables',
    subCategorySlug: isWatch ? 'fx-smart-watches' : 'fx-fitness-trackers',
    price,
    compareAtPrice,
    sku,
    isFeatured,
    tags: tagsFor(
      stockBand,
      isFeatured,
      isWatch ? ['watch', 'wearable'] : ['tracker', 'wearable'],
      index,
    ),
    stockBand,
  };
}

function home(
  index: number,
  model: string,
  family: 'waterBottle' | 'smartHomeHub',
  price: number,
  sku: string,
  isFeatured: boolean,
  stockBand: ProductRow['stockBand'],
  compareAtPrice?: number,
): ProductRow {
  const isBottle = family === 'waterBottle';
  return {
    slug: `fx-${isBottle ? 'bottle' : 'hub'}-${kebab(model)}`,
    name: localized({
      en: `${model}${isBottle ? '' : ' Smart Hub'}`,
      fr: `${isBottle ? 'Gourde' : 'Hub connecté'} ${model}`,
      ar: `${isBottle ? 'زجاجة مياه' : 'مركز ذكي'} ${model}`,
    }),
    shortDescription: localized({
      en: isBottle
        ? `Refill-friendly ${model.toLowerCase()} water bottle for daily carry.`
        : `Quiet ${model.toLowerCase()} smart hub to coordinate your home in Arabic or English.`,
      fr: isBottle
        ? `Gourde ${model} facile à remplir, pour le quotidien.`
        : `Hub connecté ${model} discret, pour piloter la maison en arabe ou en anglais.`,
      ar: isBottle
        ? `زجاجة مياه ${model} سهلة التعبئة للاستخدام اليومي.`
        : `مركز ${model} ذكي وهادئ لإدارة منزلك بالعربية أو الإنجليزية.`,
    }),
    description: localized({
      en: isBottle
        ? `Textured grip sleeve, leak-proof cap, and a glass body you can actually clean. The ${model} sits well in a backpack or a car cup-holder.`
        : `Voice control in Arabic + English, fabric finish that fits any majlis, and a minimal screen that stays out of the way. Pairs with the apps you already use.`,
      fr: isBottle
        ? `Manchon texturé, bouchon étanche et corps en verre qui se nettoie vraiment. La gourde ${model} tient bien dans un sac à dos ou un porte-gobelet de voiture.`
        : `Commande vocale en arabe et en anglais, finition en tissu qui s'accorde à tout majlis et écran minimal qui ne gêne jamais. Compatible avec les applications que vous utilisez déjà.`,
      ar: isBottle
        ? `غلاف مقبض مضلع وغطاء مانع للتسرب وجسم زجاجي يسهل تنظيفه فعلاً. تناسب زجاجة ${model} حقيبة الظهر أو حامل الأكواب في السيارة.`
        : `تحكم صوتي بالعربية والإنجليزية وتشطيب قماشي يناسب أي مجلس وشاشة بسيطة لا تزعجك. يعمل مع التطبيقات التي تستخدمها بالفعل.`,
    }),
    metaTitle: localized({
      en: `${model}${isBottle ? ' Bottle' : ' Smart Hub'}`,
      fr: `${isBottle ? 'Gourde' : 'Hub connecté'} ${model}`,
      ar: `${isBottle ? 'زجاجة مياه' : 'مركز ذكي'} ${model}`,
    }),
    metaDescription: localized({
      en: `${model} ${isBottle ? 'water bottle' : 'smart hub'}, shipped fast, COD welcome.`,
      fr: `${isBottle ? 'Gourde' : 'Hub connecté'} ${model}, expédition et paiement à la livraison.`,
      ar: `${isBottle ? 'زجاجة مياه' : 'مركز ذكي'} ${model}، شحن سريع ودفع عند الاستلام.`,
    }),
    family,
    categorySlug: 'fx-home-essentials',
    subCategorySlug: isBottle ? 'fx-hydration' : 'fx-smart-home',
    price,
    compareAtPrice,
    sku,
    isFeatured,
    tags: tagsFor(
      stockBand,
      isFeatured,
      isBottle ? ['bottle', 'home'] : ['smart-home', 'home'],
      index,
    ),
    stockBand,
  };
}

function personal(
  index: number,
  setEn: string,
  setFr: string,
  setAr: string,
  price: number,
  sku: string,
  isFeatured: boolean,
  stockBand: ProductRow['stockBand'],
  compareAtPrice?: number,
): ProductRow {
  return {
    slug: `fx-skincare-${kebab(setEn)}`,
    name: localized({ en: setEn, fr: setFr, ar: setAr }),
    shortDescription: localized({
      en: `${setEn}, a small skincare set built around what works in climate.`,
      fr: `${setFr}, un petit coffret de soin construit autour de ce qui fonctionne sous le climat.`,
      ar: `${setAr}، مجموعة صغيرة للعناية بالبشرة مبنية على ما يناسب المناخ.`,
    }),
    description: localized({
      en: `Five-piece set: cleanser, hydrating serum, moisturizer, sunscreen, and a soft eye cream. Light textures, fragrance-free, dermatologically tested, and travel-ready in glass jars and bottles.`,
      fr: `Coffret de cinq pièces : nettoyant, sérum hydratant, crème hydratante, protection solaire et un contour des yeux léger. Textures légères pensées pour le, sans parfum, testées sous contrôle dermatologique et prêtes au voyage en pots et flacons de verre.`,
      ar: `مجموعة من خمس قطع: منظف وسيروم مرطب وكريم مرطب وواقٍ من الشمس وكريم خفيف للعين. قوامات خفيفة وخالية من العطور ومختبرة جلدياً وجاهزة للسفر في برطمانات وزجاجات زجاجية.`,
    }),
    metaTitle: localized({
      en: `${setEn}, Northwind`,
      fr: `${setFr}, Northwind`,
      ar: `${setAr}، Northwind`,
    }),
    metaDescription: localized({
      en: `${setEn} skincare set, shipped fast, cash on delivery available.`,
      fr: `Coffret de soin ${setFr} adapté au climat, expédition rapide avec paiement à la livraison.`,
      ar: `مجموعة العناية ${setAr} مناسبة للمناخ، شحن سريع ودفع عند الاستلام.`,
    }),
    family: 'skincare',
    categorySlug: 'fx-personal-care',
    price,
    compareAtPrice,
    sku,
    isFeatured,
    tags: tagsFor(stockBand, isFeatured, ['skincare', 'personal-care'], index),
    stockBand,
  };
}

function tagsFor(
  stock: ProductRow['stockBand'],
  featured: boolean,
  base: string[],
  index: number,
): string[] {
  // Tag vocabulary per tasks.md S2.4: bestseller / new-arrival / featured / cod-eligible.
  // OOS state is derivable from `StockLevel.onHand` so no `out-of-stock` tag.
  const out = [...base, 'cod-eligible'];
  if (featured) out.push('featured');
  if (stock === 'in') out.push('bestseller');
  // First two products in each family carry the new-arrival tag — gives the
  // storefront's "Just Arrived" home row real data without needing a date filter.
  if (index <= 2) out.push('new-arrival');
  return out;
}

function kebab(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Seeder ───────────────────────────────────────────────────────────────────

export interface SeededProduct {
  id: string;
  slug: string;
  variantId: string;
  /** Raw row used by inventory/reviews/questions modules to look up stock band etc. */
  row: ProductRow;
}

export async function seedProducts(args: {
  prisma: PrismaClient;
  storage?: SeedStorageDriver;
  categories: SeededCategory[];
}): Promise<SeededProduct[]> {
  const storage = args.storage ?? resolveSeedStorageDriver();
  const categoryBySlug = new Map(args.categories.map((c) => [c.slug, c]));
  const out: SeededProduct[] = [];

  for (const row of FIXTURE_CATALOGUE_PRODUCTS) {
    const cat = categoryBySlug.get(row.categorySlug);
    if (!cat) {
      throw new Error(`Unknown category slug ${row.categorySlug} for product ${row.slug}`);
    }

    // 1. Resolve image sources for hero + gallery (with hero-clone fallback).
    const family = FAMILIES[row.family];
    const heroPath = resolveFamilySource(family.hero);
    // Offset by position so a gallery entry does not land on the hero's tile.
    const gallerySources: string[] = family.gallery.map((g, i) => seedImagePath(g, i + 1));

    // 2. Ingest hero + gallery, unless this is the one row kept assetless.
    const assetless = row.slug === ASSETLESS_PRODUCT_SLUG;
    const heroAssetId = assetless
      ? null
      : await safeIngest({
          prisma: args.prisma,
          storage,
          sourcePath: heroPath,
          alt: row.name,
          label: `${row.slug} hero`,
        });
    const galleryAssetIds: string[] = [];
    for (const src of assetless ? [] : gallerySources) {
      const id = await safeIngest({
        prisma: args.prisma,
        storage,
        sourcePath: src,
        alt: row.name,
        label: `${row.slug} gallery`,
      });
      if (id) galleryAssetIds.push(id);
    }
    // Fill the gallery up to two entries from the product's own key, walking
    // the tile set. It used to re-ingest the hero, which returns the hero's own
    // asset id, and `ProductAsset` is unique on (productId, assetId): a gallery
    // of clones could never have been joined.
    for (let variant = 1; !assetless && galleryAssetIds.length < 2; variant++) {
      if (variant > TILE_FILL_ATTEMPTS) break;
      const fillId = await safeIngest({
        prisma: args.prisma,
        storage,
        sourcePath: seedImagePath(row.slug, variant),
        alt: row.name,
        label: `${row.slug} gallery-fill`,
      });
      if (!fillId) break;
      if (fillId !== heroAssetId && !galleryAssetIds.includes(fillId)) {
        galleryAssetIds.push(fillId);
      }
    }

    // 3. Product row.
    // Use upsert by slug so re-seeds after a soft-delete cycle do not hit a
    // unique constraint violation. `deletedAt: null` restores a previously
    // soft-deleted row; all fields are updated in place.
    const productData = {
      name: row.name satisfies Prisma.InputJsonValue,
      description: row.description satisfies Prisma.InputJsonValue,
      shortDescription: row.shortDescription satisfies Prisma.InputJsonValue,
      metaTitle: row.metaTitle satisfies Prisma.InputJsonValue,
      metaDescription: row.metaDescription satisfies Prisma.InputJsonValue,
      status: ProductStatus.ACTIVE,
      isFeatured: row.isFeatured,
      tags: row.tags,
      brand: row.brand ?? null,
      publishedAt: new Date(),
      deletedAt: null,
    };
    const product = await args.prisma.product.upsert({
      where: { slug: row.slug },
      create: { slug: row.slug, ...productData },
      update: productData,
    });

    // 4. Single default variant.
    // Same pattern: upsert by SKU, clear deletedAt on re-seed.
    const variantData = {
      productId: product.id,
      price: row.price,
      compareAtPrice: row.compareAtPrice ?? null,
      isDefault: true,
      isActive: true,
      deletedAt: null,
    };
    const variant = await args.prisma.productVariant.upsert({
      where: { sku: row.sku },
      create: { sku: row.sku, ...variantData },
      update: variantData,
    });

    // 5. Category join — parent. Subcategory join is appended below when
    // the row supplies a `subCategorySlug` so /catalog/{parent} continues
    // to surface the full mix while /catalog/{sub} filters to the subset.
    await args.prisma.productCategory.create({
      data: { productId: product.id, categoryId: cat.id },
    });
    if (row.subCategorySlug) {
      const sub = categoryBySlug.get(row.subCategorySlug);
      if (!sub) {
        throw new Error(`Unknown subcategory slug ${row.subCategorySlug} for product ${row.slug}`);
      }
      await args.prisma.productCategory.create({
        data: { productId: product.id, categoryId: sub.id },
      });
    }

    // 6. Asset joins (hero isPrimary, gallery sortOrder 1..N).
    //
    // Deduped: `ingestImage` returns the SAME asset for the same picture, and
    // `ProductAsset` is unique on (productId, assetId), so a product whose hero
    // and gallery resolve to one image would fail its second join. Which
    // pictures a fixture lands on is not worth a crash.
    const linked = new Set<string>();
    if (heroAssetId) {
      await args.prisma.productAsset.create({
        data: { productId: product.id, assetId: heroAssetId, sortOrder: 0, isPrimary: true },
      });
      linked.add(heroAssetId);
    }
    for (let i = 0; i < galleryAssetIds.length; i++) {
      if (linked.has(galleryAssetIds[i])) continue;
      linked.add(galleryAssetIds[i]);
      await args.prisma.productAsset.create({
        data: {
          productId: product.id,
          assetId: galleryAssetIds[i],
          sortOrder: i + 1,
          isPrimary: false,
        },
      });
    }

    out.push({ id: product.id, slug: row.slug, variantId: variant.id, row });
  }

  return out;
}

async function safeIngest(args: {
  prisma: PrismaClient;
  storage: SeedStorageDriver;
  sourcePath: string;
  alt: Translatable;
  label: string;
}): Promise<string | null> {
  try {
    const { assetId } = await ingestImage({
      prisma: args.prisma,
      storage: args.storage,
      sourcePath: args.sourcePath,
      alt: args.alt,
    });
    return assetId;
  } catch (err) {
    console.warn(
      ` [fixture-catalogue] image ingest failed for ${args.label} (${args.sourcePath}): ${(err as Error).message}`,
    );
    return null;
  }
}
