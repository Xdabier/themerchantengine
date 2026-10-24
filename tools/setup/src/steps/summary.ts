import { ui } from '../cli/ui';
import { StepFailed, type Step, type StepContext } from './types';

/** The lines the summary prints, one per answered group, secrets never among them. */
export function summaryLines(ctx: StepContext): string[] {
  const a = ctx.answers;
  const lines: string[] = [`profile: ${a.profile}`];
  if (a.identity)
    lines.push(
      `store: ${a.identity.storeName?.['default']} (${a.identity.brandName}), ${a.identity.country}`,
    );
  if (a.domains)
    lines.push(`domains: ${a.domains.storefront} | ${a.domains.admin} | ${a.domains.api}`);
  if (a.license) lines.push(`license: ${a.license.file || 'none (unlicensed)'}`);
  if (a.brand)
    lines.push(
      `brand: ${a.brand.primary}${a.brand.secondary ? ` + ${a.brand.secondary}` : ''}${a.brand.accent ? ` + ${a.brand.accent}` : ''}, ${a.brand.fontKit}${a.brand.logoPath ? `, logo ${a.brand.logoPath}` : ''}`,
    );
  if (a.localization)
    lines.push(
      `locales: ${a.localization.supportedLocales?.join(', ')} (default ${a.localization.defaultLocale}), ${a.localization.timezone}`,
    );
  if (a.money)
    lines.push(
      `money: ${a.money.currencyCode} ${a.money.symbol} ${a.money.symbolPosition}, ${a.money.displayPrecision} decimals, VAT ${Math.round((a.money.vatRate ?? 0) * 10000) / 100}% ${a.money.taxDisplay}, shipping ${a.money.shippingFlatRate}`,
    );
  if (a.storage)
    lines.push(
      `storage: ${a.storage.driver}${a.storage.bucket ? ` ${a.storage.bucket} at ${a.storage.endpoint}` : ''}`,
    );
  if (a.mail)
    lines.push(
      `mail: ${a.mail.transport} from ${a.mail.fromName} <${a.mail.fromEmail}>${a.mail.devRedirectTo ? `, redirected to ${a.mail.devRedirectTo}` : ''}`,
    );
  if (a.turnstile) lines.push(`turnstile: ${a.turnstile.enabled ? 'on' : 'off'}`);
  if (a.seo)
    lines.push(
      `seo: ${[a.seo.indexNowKey && 'IndexNow', a.seo.bingApiKey && 'Bing', a.seo.gscServiceAccountFile && 'Search Console'].filter(Boolean).join(', ') || 'none'}`,
    );
  if (a.payments)
    lines.push(
      `payments: ${[a.payments.cod && 'cod', a.payments.manual && 'manual', a.payments.stripe && 'stripe'].filter(Boolean).join(', ') || 'none'}`,
    );
  if (a.owner) lines.push(`owner: ${a.owner.firstName} ${a.owner.lastName} <${a.owner.email}>`);
  if (a.demoCatalogue !== undefined)
    lines.push(`demo catalogue: ${a.demoCatalogue ? 'yes' : 'no'}`);
  return lines;
}

/** The last step: everything answered, on one screen, and a yes before anything is written or run. */
export const summaryStep: Step = {
  id: 'summary',
  title: 'Summary and confirm',
  async run(ctx) {
    for (const line of summaryLines(ctx)) ui.note(ctx.out, line);
    const confirmed = await ctx.prompter.confirm({
      path: 'confirm',
      label: ctx.dryRun ? 'Print what the install would do?' : 'Install with these answers?',
      initial: true,
    });
    if (!confirmed)
      throw new StepFailed('summary', 'not confirmed; run setup again to change an answer');
  },
};
