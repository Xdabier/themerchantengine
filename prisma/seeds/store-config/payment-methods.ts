import type { PrismaClient } from '@prisma/client';
import { localized } from '../lib/localized';

/**
 * Seeds the one tender every store starts with: cash on delivery.
 *
 * The API refuses an order when the enabled payment-method set is empty, so a
 * store needs at least one row before its first checkout. COD needs no
 * provider credentials, which is what makes it safe to seed (§3.7 forbids
 * secrets in a seed); `config` stays empty.
 *
 * CREATE-ONLY on the operator-owned flags, like the guest-checkout flag beside
 * it: an upsert that also updated would switch the method back on, and rewrite
 * its name, every time a deploy ran, undoing an operator who had turned it off
 * or renamed it. The row is reconciled only into existence.
 */
export const COD_PAYMENT_METHOD_CODE = 'cod';

const codName = () =>
  localized({
    en: 'Cash on delivery',
    fr: 'Paiement à la livraison',
    ar: 'الدفع عند الاستلام',
  });

const codDescription = () =>
  localized({
    en: 'Pay the courier in cash when your order arrives.',
    fr: 'Réglez en espèces au livreur à la réception de votre commande.',
    ar: 'ادفع نقدًا لمندوب التوصيل عند استلام طلبك.',
  });

export async function seedPaymentMethods(
  prisma: PrismaClient,
): Promise<{ code: string; created: boolean }> {
  const existing = await prisma.paymentMethod.findUnique({
    where: { code: COD_PAYMENT_METHOD_CODE },
    select: { id: true },
  });
  if (existing) return { code: COD_PAYMENT_METHOD_CODE, created: false };

  await prisma.paymentMethod.create({
    data: {
      code: COD_PAYMENT_METHOD_CODE,
      name: codName(),
      description: codDescription(),
      provider: 'cod',
      isActive: true,
      isTestMode: false,
      sortOrder: 0,
      config: {},
    },
  });
  return { code: COD_PAYMENT_METHOD_CODE, created: true };
}
