import type { PrismaClient, User } from '@prisma/client';
import { Prisma, QuestionStatus } from '@prisma/client';
import type { SeededProduct } from './products';

/**
 * 1-5 product Q&A entries per product. Half answered, half pending.
 * Mix of authenticated (askedById from reviewer pool) and anonymous.
 */
const QUESTIONS_EN = [
  'Does this come with a regional warranty?',
  'Is the box sealed when shipped?',
  'Can I pay cash on delivery?',
  'Does it support my language out of the box?',
  'How long is the shipping to Saudi Arabia?',
  'Is the charger included?',
  'Is there an extended warranty option?',
  'What is the return policy if it does not fit?',
];

const QUESTIONS_FR = [
  'La garantie régionale est-elle incluse ?',
  "La boîte est-elle scellée au moment de l'expédition ?",
  'Puis-je payer en espèces à la livraison ?',
  "L'interface en arabe est-elle disponible dès la sortie de boîte ?",
  "Combien de temps prend la livraison vers l'Arabie saoudite ?",
  'Le chargeur est-il inclus ?',
  'Existe-t-il une option de garantie étendue ?',
  'Quelle est la politique de retour si la taille ne convient pas ?',
];

const ANSWERS_EN = [
  'Yes, every Northwind order includes a one-year warranty by default.',
  'Yes, the box ships sealed and tamper-evident.',
  'Yes, cash on delivery is available.',
  'Yes, the interface ships with full Arabic support out of the box.',
  'Most KSA orders arrive in 3-5 business days.',
  'Yes, the charger is included with every unit.',
  'Yes — extended warranty can be added at checkout.',
  'You can return any unopened item within 14 days for a full refund.',
];

const ANSWERS_FR = [
  "Oui, chaque commande Northwind inclut par défaut une garantie d'un an.",
  'Oui, la boîte part scellée avec un sceau inviolable.',
  'Oui, le paiement à la livraison est disponible.',
  "Oui, l'appareil prend en charge l'arabe dès la première utilisation.",
  "La plupart des commandes vers l'Arabie saoudite arrivent en 3 à 5 jours ouvrés.",
  'Oui, le chargeur est inclus avec chaque appareil.',
  'Oui, une garantie étendue peut être ajoutée au moment du paiement.',
  'Vous pouvez retourner tout article non ouvert sous 14 jours pour un remboursement intégral.',
];

export async function seedQuestions(args: {
  prisma: PrismaClient;
  products: SeededProduct[];
  reviewers: User[];
}): Promise<{ questions: number }> {
  let total = 0;
  let cycle = 0;

  for (const product of args.products) {
    // ~80% of products carry questions; the rest stay empty.
    if (cycle % 5 === 0) {
      cycle += 1;
      continue;
    }
    const count = 1 + (cycle % 5); // 1..5
    for (let i = 0; i < count; i++) {
      const isFrench = (cycle + i) % 2 === 0;
      const isAnswered = (cycle + i) % 2 === 0;
      const isAnonymous = (cycle + i) % 3 === 0;
      const askedBy = isAnonymous ? null : args.reviewers[(cycle + i) % args.reviewers.length];

      const question = isFrench
        ? QUESTIONS_FR[(cycle + i) % QUESTIONS_FR.length]
        : QUESTIONS_EN[(cycle + i) % QUESTIONS_EN.length];
      const answer = isAnswered
        ? isFrench
          ? ANSWERS_FR[(cycle + i) % ANSWERS_FR.length]
          : ANSWERS_EN[(cycle + i) % ANSWERS_EN.length]
        : null;

      const questionLocale = isFrench ? 'fr' : 'en';
      await args.prisma.productQuestion.create({
        data: {
          productId: product.id,
          question: { default: question, [questionLocale]: question },
          questionLocale,
          askedById: askedBy?.id ?? null,
          answer: answer ? { default: answer, [questionLocale]: answer } : Prisma.JsonNull,
          answeredBy: isAnswered ? 'fx-seed-staff' : null,
          isAdminAnswer: isAnswered,
          helpfulCount: (cycle + i) % 7,
          status: isAnswered ? QuestionStatus.PUBLISHED : QuestionStatus.PENDING,
        },
      });
      total += 1;
    }
    cycle += 1;
  }

  return { questions: total };
}
