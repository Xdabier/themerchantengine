import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import {
  copyFor,
  BRAND_TOKENS,
  escapeVars,
  renderLayout,
  renderText,
  highPunctuationSpace,
} from './layout';

export interface Vars {
  fromName: string;
  fromEmail: string;
  subjectLine: string;
  message: string;
  submittedAt: string;
}

// Staff-facing notice: the storefront contact form landing in the shop's own
// inbox. It carries the submission as labelled facts and nothing else, so no
// salutation and no commentary.
const COPY = {
  fr: {
    subject: (vars: Vars) => `[Contact] ${vars.subjectLine}`,
    preheader: 'Nouveau message envoyé depuis le formulaire de contact.',
    heading: 'Nouveau message du formulaire de contact',
    fromLabel: 'Expéditeur',
    subjectLabel: 'Objet',
    messageLabel: 'Message',
    receivedLabel: 'Reçu le',
  },
  en: {
    subject: (vars: Vars) => `[Contact] ${vars.subjectLine}`,
    preheader: 'New storefront contact form submission.',
    heading: 'New contact form submission',
    fromLabel: 'From',
    subjectLabel: 'Subject',
    messageLabel: 'Message',
    receivedLabel: 'Received',
  },
  ar: {
    subject: (vars: Vars) => `[Contact] ${vars.subjectLine}`,
    preheader: 'رسالة جديدة من نموذج التواصل.',
    heading: 'رسالة جديدة من نموذج التواصل',
    fromLabel: 'المرسل',
    subjectLabel: 'الموضوع',
    messageLabel: 'الرسالة',
    receivedLabel: 'تاريخ الاستلام',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  // French puts a no-break space before a colon; the other locales put none.
  // The plain-text arm is read as typed, so it carries the codepoint.
  const colon = `${highPunctuationSpace(locale)}:`;
  const t = copyFor(COPY, locale);
  // Every field below is anonymous storefront input landing in the staff inbox,
  // so the HTML arm reads the escaped copy exclusively.
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 16px;">${t.heading}</h1>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;">
  <tr><td style="color:${BRAND_TOKENS.muted};padding:6px 0;width:120px;">${t.fromLabel}</td><td style="padding:6px 0;">${e.fromName} &lt;${e.fromEmail}&gt;</td></tr>
  <tr><td style="color:${BRAND_TOKENS.muted};padding:6px 0;">${t.subjectLabel}</td><td style="padding:6px 0;">${e.subjectLine}</td></tr>
  <tr><td style="color:${BRAND_TOKENS.muted};padding:6px 0;">${t.receivedLabel}</td><td style="padding:6px 0;">${e.submittedAt}</td></tr>
</table>
<div style="margin-top:20px;padding:16px 18px;background:${BRAND_TOKENS.paper};border:1px solid ${BRAND_TOKENS.border};">
  <div style="color:${BRAND_TOKENS.muted};font-size:12px;margin-bottom:8px;">${t.messageLabel}</div>
  <div style="white-space:pre-wrap;">${e.message}</div>
</div>`;
  return {
    subject: t.subject(vars),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([
      `${t.fromLabel}${colon} ${vars.fromName} <${vars.fromEmail}>`,
      `${t.subjectLabel}${colon} ${vars.subjectLine}`,
      `${t.receivedLabel}${colon} ${vars.submittedAt}`,
      '',
      vars.message,
    ]),
  };
}
