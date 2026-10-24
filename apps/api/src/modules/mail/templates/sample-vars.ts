const NARROW_NO_BREAK_SPACE = String.fromCodePoint(0x202f);
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0);

/**
 * A money display form: three fraction digits, U+202F between thousands
 * groups, U+00A0 before the symbol, symbol last, no ISO code. Every money
 * variable in the bag carries this exact string so the tax-mention assertion
 * below can look for it.
 */
export const MONEY = `1${NARROW_NO_BREAK_SPACE}240,000${NO_BREAK_SPACE}€`;

/**
 * The union of every flow's `Vars`. Values are chosen to be inert against the
 * assertions themselves: no exclamation mark, no Arabic, no client trace, and
 * no urgency phrasing. `periodLabel` deliberately avoids the producer's
 * literal `les 7 derniers jours`: that is a date-range descriptor in a staff
 * digest rather than scarcity framing, and feeding it in would fail the copy
 * rule on the sample data instead of on the copy under test.
 */
export const SAMPLE_VARS: Record<string, unknown> = {
  // people + identity
  customerName: 'Ben Salah',
  firstName: 'Ben Salah',
  recipientName: 'Ben Salah',
  purchaserName: 'Ben Amor',
  inviterName: 'Ben Amor',
  fromName: 'Ben Salah',
  fromEmail: 'contact@example.test',
  currentEmail: 'ancienne@example.test',
  newEmail: 'nouvelle@example.test',
  role: 'Manager',
  appName: 'example.test',

  // identifiers
  orderNumber: 'CMD-2026-000412',
  returnNumber: 'RET-2026-000031',
  trackingNumber: 'TRK0090182773',
  carrier: 'Aramex',
  code: 'GC-4K7Q-9M2X',
  otp: '482913',
  productName: 'Lampe de bureau, modèle 4',

  // free text
  subjectLine: 'Demande de devis',
  message: 'Bonjour, merci de me communiquer un devis.',
  personalMessage: 'Bon usage.',
  reason: 'Rupture fournisseur',
  refundDetail: 'Le remboursement est effectué sur la carte utilisée.',
  // The exact shapes the producers now send, per `mail/mail-date.util.ts`.
  submittedAt: 'mardi 24 mars 2026 à 14:32',
  expiresOn: 'mardi 30 juin 2026',
  periodLabel: 'la semaine écoulée',

  // counts
  itemCount: 3,
  orders: 42,
  newCustomers: 7,
  lowStockCount: 5,
  outOfStockCount: 2,
  newReturnsCount: 4,
  pendingReviewsCount: 6,

  // money, already display-formatted
  total: MONEY,
  subtotal: MONEY,
  revenue: MONEY,
  aov: MONEY,
  balance: MONEY,
  initialBalance: MONEY,
  amountRedeemed: MONEY,
  remainingBalance: MONEY,
  refundAmount: MONEY,

  // urls
  actionUrl: 'https://example.test/fr/compte/action?token=abc123',
  orderUrl: 'https://example.test/fr/compte/commandes/CMD-2026-000412',
  returnUrl: 'https://example.test/fr/compte/retours/RET-2026-000031',
  reviewUrl: 'https://example.test/fr/compte/avis/CMD-2026-000412',
  productUrl: 'https://example.test/fr/catalog/product/lampe-de-bureau',
  cartUrl: 'https://example.test/fr/panier',
  storefrontUrl: 'https://example.test/fr',
  redemptionUrl: 'https://example.test/fr/carte-cadeau',
  confirmUrl: 'https://example.test/fr/newsletter/confirmer?token=abc123',
  securityUrl: 'https://example.test/fr/compte/securite',
  trackingUrl: 'https://tracking.example.test/TRK0090182773',
  adminUrl: 'https://admin.example.test/tableau-de-bord',
};
