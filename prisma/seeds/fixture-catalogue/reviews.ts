import type { PrismaClient, User } from '@prisma/client';
import { ReviewStatus } from '@prisma/client';
import type { SeededProduct } from './products';

/**
 * 3-15 reviews per product, distributed weighted toward 4-5 stars,
 * mixed fr/en locale, ~70% verified-purchase, status=PUBLISHED.
 * Honors the @@unique([productId, userId]) constraint by drawing from
 * the reviewer pool without replacement per product.
 */
const REVIEW_BODIES_EN = [
  'Honestly arrived faster than expected. Quality matches the photos.',
  'Solid build and the packaging was clean. Would buy again.',
  'Useful and well thought out. The Arabic support is a real plus.',
  'Good value for what you pay. No complaints from me.',
  'Bought it for my brother — he is happy. Easy COD checkout too.',
  'Works as described. The instructions were clear in both languages.',
  'Honestly impressed. The finish feels expensive for the price band.',
  'Took a couple of days to arrive. Worth the wait.',
  'Solid. The little details are what make this stand out.',
  'Clean design and the materials feel right in hand.',
];

const REVIEW_BODIES_FR = [
  'Arrivé plus vite que prévu, et la qualité correspond aux photos.',
  'Fabrication solide et emballage propre. Je recommanderai chez eux.',
  "Utile et bien pensé. La prise en charge de l'arabe est un vrai plus.",
  'Bon rapport qualité-prix, rien à redire de mon côté.',
  'Acheté pour mon frère, il en est content. Le paiement à la livraison a été simple.',
  'Fonctionne exactement comme décrit. La notice est claire dans les deux langues.',
  'Franchement convaincu. La finition fait haut de gamme pour ce prix.',
  "Deux jours pour arriver. Cela valait l'attente.",
  'Solide, et ce sont les petits détails qui font la différence.',
  'Design épuré et matériaux agréables en main.',
];

const REVIEW_TITLES_EN = [
  'Good buy',
  'Recommended',
  'Honestly impressed',
  'Does the job',
  'Would buy again',
  'Solid pick',
  'Worth it',
  'No regrets',
];

const REVIEW_TITLES_FR = [
  'Bon achat',
  'Je recommande',
  'Franchement convaincu',
  'Fait le travail',
  'Je rachèterai',
  'Bon choix',
  'Cela en vaut la peine',
  'Aucun regret',
];

export async function seedReviews(args: {
  prisma: PrismaClient;
  products: SeededProduct[];
  reviewers: User[];
}): Promise<{ reviews: number }> {
  let total = 0;
  let cycleSeed = 0;

  for (const product of args.products) {
    const count = 3 + (cycleSeed % 13); // 3..15
    cycleSeed += 1;
    const pool = shuffleByCycle(args.reviewers, cycleSeed);
    const slice = pool.slice(0, Math.min(count, args.reviewers.length));

    for (let i = 0; i < slice.length; i++) {
      const reviewer = slice[i];
      const ratingPick = (cycleSeed + i) % 10;
      const rating =
        ratingPick < 6 ? 5 : ratingPick < 8 ? 4 : ratingPick < 9 ? 3 : ratingPick === 9 ? 2 : 1;
      const isFrench =
        reviewer.locale === 'fr' ? (i + cycleSeed) % 5 !== 0 : (i + cycleSeed) % 5 === 0;
      const body = isFrench
        ? REVIEW_BODIES_FR[(i + cycleSeed) % REVIEW_BODIES_FR.length]
        : REVIEW_BODIES_EN[(i + cycleSeed) % REVIEW_BODIES_EN.length];
      const title = isFrench
        ? REVIEW_TITLES_FR[(i + cycleSeed) % REVIEW_TITLES_FR.length]
        : REVIEW_TITLES_EN[(i + cycleSeed) % REVIEW_TITLES_EN.length];

      const reviewLocale = isFrench ? 'fr' : 'en';
      await args.prisma.review.create({
        data: {
          productId: product.id,
          userId: reviewer.id,
          title: { default: title, [reviewLocale]: title },
          body: { default: body, [reviewLocale]: body },
          locale: reviewLocale,
          rating,
          verifiedPurchase: (i + cycleSeed) % 10 < 7,
          status: ReviewStatus.PUBLISHED,
          helpfulCount: (i + cycleSeed) % 13,
        },
      });
      total += 1;
    }
  }

  return { reviews: total };
}

function shuffleByCycle<T>(arr: T[], cycle: number): T[] {
  const out = [...arr];
  for (let i = 0; i < out.length; i++) {
    const j = (i + cycle * 3 + 7) % out.length;
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
