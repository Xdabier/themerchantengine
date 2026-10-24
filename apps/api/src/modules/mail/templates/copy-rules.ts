/**
 * The copy rules both renderer tiers are held to, in one place.
 *
 * The file templates here and the seeded defaults in
 * `prisma/notification-template-defaults.ts` render the same 36 flows. The
 * rules that pin their shared seams were once written twice, once per spec,
 * and drifted the same way the copy had. Exported once so a third copy cannot
 * be written.
 *
 * The seeded tier cannot import from here (it must stay import-free for the
 * slim production seed image), so its spec imports these instead.
 */

/**
 * A salutation standing on its own, rather than opening a sentence.
 *
 * A message heads with a noun phrase and the customer is addressed, when at
 * all, inline in the first sentence. The pattern matches a block that is ONLY
 * a greeting word plus a name, in any of the three locales, so a real opening
 * such as `Sam, your order has shipped` does not trip it.
 */
export const SALUTATION_ALONE =
  /^(Dear|Hello|Hi|Bonjour|Cher|Chère|Madame|Monsieur|مرحبا|مرحباً|أهلا|أهلاً|عزيزي|عزيزتي)\b[^.<]*$/i;

/**
 * Flows that reach staff or the shop's own inbox rather than a customer. The
 * customer-register rules do not apply to them.
 */
export const STAFF_FLOWS: ReadonlySet<string> = new Set([
  'admin.kpi-digest',
  'admin.ops-digest',
  'admin.staff-invite',
  'contact-form',
]);
