import { storeLocales } from '@common/locale';
import { defaultMailLocale, type MailLocale } from '../mail.types';

/**
 * The single locale resolver for every outbound message.
 *
 * Before D7 the same rule was implemented six times, here, in
 * `auth-mailer.provider.ts`, twice in `notification-templates.service.ts`, and
 * as a chain inside `render.ts` and `resolvers.ts`, each with its own
 * polarity. They all funnel through this now.
 *
 * Normalises any stored locale string (BCP-47, `fr-CA`, `EN`, a stale row) to
 * a locale the store has ENABLED. A value outside the enabled set resolves to
 * the store default, not to whatever the row says: a customer who signed up
 * while a locale was enabled must still get a message the store can send once
 * the operator narrows the set.
 */
export function resolveLocale(raw: string | null | undefined): MailLocale {
  const fallback = defaultMailLocale();
  if (!raw) return fallback;
  const tag = raw.toLowerCase();
  const enabled = storeLocales.current().supportedLocales as readonly MailLocale[];
  return enabled.find((l) => tag.startsWith(l)) ?? fallback;
}
