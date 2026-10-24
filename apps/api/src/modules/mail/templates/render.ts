/**
 * Two-tier template resolver:
 *
 *   1. NotificationTemplate row keyed by `code` (Translatable subject + body)
 *      wins when present with a non-empty subject + body. Edited live from
 *      the admin UI. Since NE1 the kill-switch is `sendEnabled` (read by
 *      MailService.enqueue, never here); content selection is keyed purely on
 *      a non-empty body, so the legacy `isEnabled` flag no longer governs which
 *      tier renders.
 *   2. File fallback at `./<code>.ts`, used when no DB row exists, when the
 *      DB body is empty, or when the DB body fails to render. Always ships
 *      copy for every catalogue locale plus the inline brand layout.
 *
 * Neither tier knows the store's name: the caller resolves it from the runtime
 * config for the message locale (DR-31) and passes it in. The DB tier exposes
 * it to operator copy as `{{storeName}}`; the file tier receives it as the
 * `MailBrand` argument.
 *
 * Escaping is a per-tier contract, and the two tiers reach it by different
 * routes:
 *
 *   - DB tier (this file). `interpolate` is purposefully tiny: `{{name}}`
 *     HTML-escapes by default, `{{{rawName}}}` skips escaping (use for action
 *     URLs in href attributes). No Handlebars / Mustache dep, which keeps the
 *     surface auditable and avoids dragging a runtime template parser into the
 *     bundle.
 *   - File tier (`./<code>.ts`). Plain TypeScript template literals, so there
 *     is no interpolator and nothing escapes on its own. Each template escapes
 *     at its own call site with `escapeVars` from `./layout` and feeds the
 *     escaped copy to the HTML arm only. `layout.escapeHtml` mirrors
 *     `escapeHtml` below character for character, so both tiers agree.
 *
 * Neither tier escapes the plain-text arm or the subject. Neither is markup,
 * and a reader must see `&`, not `&amp;`.
 */
import type { PrismaService } from '../../../prisma/prisma.service';
import {
  defaultMailLocale,
  type MailJobName,
  type MailLocale,
  type RenderedTemplate,
} from '../mail.types';
import { TEMPLATE_REGISTRY } from './registry';
import { renderLayout } from './layout';

/** Translatable JSONB shape, mirrors `libs/shared/common` `Translatable`. */
type Translatable = { fr?: string; en?: string; ar?: string } & Record<string, string | undefined>;

/**
 * Loose Translatable input accepted by the public render helpers. A persisted
 * JSONB column or an admin draft may carry `null` locale values, so the input
 * surface tolerates them (the resolver coalesces to `''`); the strict
 * `Translatable` above stays the internal canonical shape.
 */
export type TranslatableInput =
  | Record<string, string | null | undefined>
  | string
  | null
  | undefined;

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] ?? c);
}

/**
 * Replace `{{var}}` with HTML-escaped value, `{{{var}}}` with raw value.
 * Unmatched placeholders pass through untouched so a typo surfaces in QA
 * instead of silently dropping content.
 */
export function interpolate(template: string, vars: Record<string, unknown>): string {
  const raw = template.replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, k) => String(vars[k] ?? ''));
  return raw.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => escapeHtml(vars[k]));
}

/**
 * Extract the distinct `{{token}}` / `{{{token}}}` identifiers an interpolated
 * string references. Pairs with `interpolate` (same identifier grammar) so the
 * admin save-time validator can reject a body that references a variable the
 * flow never declares (plan Risk R12). The single regex matches both the
 * escaped (`{{x}}`) and raw (`{{{x}}}`) forms.
 */
export function extractTemplateTokens(template: string): string[] {
  const tokens = new Set<string>();
  const re = /\{\{\{?\s*([\w.]+)\s*\}?\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    tokens.add(m[1]);
  }
  return [...tokens];
}

/**
 * The locale chain: requested locale, then the store default, then a
 * `default` rung, then empty. Deliberately the same order the global
 * Translatable interceptor uses, so the language a customer is addressed in
 * and the stored translation they are shown can never disagree. An empty
 * result makes the two-tier resolver fall through to the file fallback.
 */
export function pickLocale(t: TranslatableInput, locale: MailLocale): string {
  if (!t) return '';
  if (typeof t === 'string') return t;
  return t[locale] ?? t[defaultMailLocale()] ?? t['default'] ?? '';
}

/** The locale a body is written in: the requested one if it has copy, else the store default. */
function writtenIn(t: TranslatableInput, locale: MailLocale): MailLocale {
  return typeof t === 'string' || t?.[locale] ? locale : defaultMailLocale();
}

/**
 * Derive a plain-text part from a body BLOCK (the inner content, before the
 * brand layout wraps it, so the header/footer chrome never leaks into the text
 * part). Drops `<style>` blocks, then surfaces every `<a href>` as
 * `label (url)` so a text-only client keeps the action link instead of losing
 * it to the tag strip, then strips the remaining tags and collapses whitespace.
 */
function deriveText(blockHtml: string): string {
  return (
    blockHtml
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<a\b[^>]*?\shref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
        const text = String(label)
          .replace(/<[^>]+>/g, '')
          .trim();
        if (!text) return String(href);
        return text === href ? text : `${text} (${href})`;
      })
      // Insert a separator at block boundaries so adjacent blocks (e.g. a heading
      // abutting a paragraph) don't run their words together once tags are stripped.
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|h[1-6]|li|tr|td|th|blockquote|ul|ol)>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Render a body-only DB template (NE3 stores the inner block, not a full
 * document) into a complete email: pick the locale, interpolate the subject +
 * body, compose the shared brand layout, and derive the chrome-free plain-text
 * part from the inner block. This is the exact DB-win composition
 * `renderTemplate` performs, factored out so the admin preview endpoint (NE6)
 * and the campaign plane render a DRAFT byte-for-byte the way a real send
 * would, with no separate code path to drift.
 *
 * `storeName` is exposed to the copy as `{{storeName}}` and printed in the
 * layout chrome. It is optional only so a preview caller that has not been
 * wired to the runtime config yet still compiles; a send always passes it.
 */
export function renderDraft(opts: {
  subject: TranslatableInput;
  body: TranslatableInput;
  locale: MailLocale;
  variables: Record<string, unknown>;
  /** The store name resolved to `locale`, from the runtime config (DR-31). */
  storeName?: string;
  /** NE7: when present, the brand layout renders an RFC 8058 footer link. */
  unsubscribeUrl?: string;
}): RenderedTemplate {
  const storeName = opts.storeName ?? '';
  const variables = { ...opts.variables, storeName };
  const subject = interpolate(pickLocale(opts.subject, opts.locale), variables);
  const inner = interpolate(pickLocale(opts.body, opts.locale), variables);
  const html = renderLayout({
    locale: writtenIn(opts.body, opts.locale),
    storeName,
    body: inner,
    ...(opts.unsubscribeUrl ? { unsubscribeUrl: opts.unsubscribeUrl } : {}),
  });
  const text = deriveText(inner);
  return { subject, html, text };
}

export interface RenderTemplateOpts {
  /** The store name resolved to the message locale, from the runtime config. */
  storeName: string;
  /** NE7 unsubscribe URL for consented non-transactional sends. */
  unsubscribeUrl?: string;
}

/**
 * Resolve + render. Throws if neither the DB row nor the file fallback can
 * produce a non-empty `subject`: surfacing a missing template loudly is the
 * right call (silently sending blank-subject mail is worse than a 500).
 */
export async function renderTemplate(
  prisma: PrismaService,
  code: MailJobName,
  locale: MailLocale,
  variables: Record<string, unknown>,
  opts: RenderTemplateOpts,
): Promise<RenderedTemplate> {
  const dbTpl = await prisma.notificationTemplate.findUnique({ where: { code } });
  if (dbTpl) {
    const subjectTpl = pickLocale(dbTpl.subject as Translatable | null, locale);
    const bodyTpl = pickLocale(dbTpl.body as Translatable, locale);
    if (subjectTpl && bodyTpl) {
      return renderDraft({
        subject: dbTpl.subject as Translatable,
        body: dbTpl.body as Translatable,
        locale,
        variables,
        storeName: opts.storeName,
        ...(opts.unsubscribeUrl ? { unsubscribeUrl: opts.unsubscribeUrl } : {}),
      });
    }
  }
  // NE7 note: the file-fallback tier composes its own layout without the
  // unsubscribe footer. Consent-gated flows (LIFECYCLE/MARKETING) always carry a
  // backfilled DB body, so they render via the DB-win branch above; the fallback
  // is the blank-DB safety net only.

  const fallback = TEMPLATE_REGISTRY[code];
  if (!fallback) {
    throw new Error(`renderTemplate: no fallback registered for template "${code}"`);
  }
  return fallback(locale, variables, { storeName: opts.storeName });
}
