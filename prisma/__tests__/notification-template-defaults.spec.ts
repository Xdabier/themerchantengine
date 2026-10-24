import { describe, it, expect, vi } from 'vitest';
import {
  TEMPLATE_DEFAULTS,
  MAIL_FLOW_CODES,
  type MailFlowCode,
  type MailLocale,
} from '../notification-template-defaults';
import {
  planBackfill,
  backfillNotificationBodies,
  type TemplateRow,
} from '../backfill-notification-bodies';
import { registryLocaleCodes } from '../../libs/shared/common/src/locale/locale-registry';
import { TEMPLATE_REGISTRY } from '../../apps/api/src/modules/mail/templates/registry';

/** The whole engine catalogue: every flow ships copy for all three. */
const LOCALES: readonly MailLocale[] = registryLocaleCodes();

/**
 * Positive French-content marker.
 *
 * The non-empty / no-client checks below all pass on an English string sitting
 * in the `fr` slot. The marker is two alternatives, and a string needs only
 * one of them:
 *
 *   - a closed list of French function words. Articles, pronouns, and
 *     prepositions are unavoidable in any French sentence, so a real French
 *     body always trips one. Every word on the list was picked for having no
 *     English homograph (`a`, `on`, `plus`, `son`, `sans` are deliberately
 *     absent), and each is matched on word boundaries so it cannot fire inside
 *     inline-CSS noise such as `letter-spacing` or `sans-serif`.
 *   - a French diacritic. Several subjects are a noun phrase with no function
 *     word at all (`Retour {{returnNumber}} accepté`), and every one of them
 *     carries an accent.
 *
 * The mirror test below pins the other half of the choice: across every
 * English subject and body the marker fires zero times, so it discriminates
 * French from English rather than merely matching prose.
 */
const FRENCH_FUNCTION_WORD =
  /\b(le|la|les|de|des|du|un|une|au|aux|votre|vos|vous|nous|est|sont|et|à|pour|sur|dans|avec|par|que|qui|ne|cette|ses|leur|leurs|depuis|chez|dès|selon|entre|vers|sous)\b/i;
const FRENCH_DIACRITIC = /[éèêëàâäçùûüîïôö]/i;

function readsAsFrench(text: string): boolean {
  return FRENCH_FUNCTION_WORD.test(text) || FRENCH_DIACRITIC.test(text);
}

/**
 * Arabic script, built from codepoints rather than pasted glyphs: Arabic,
 * Arabic Supplement, Arabic Extended-A, and both Presentation Forms blocks.
 * Presentation Forms-B stops at U+FEFE on purpose: U+FEFF is the byte-order
 * mark, not Arabic.
 */
const ARABIC_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0x08a0, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfefe],
];
const ARABIC_SCRIPT = new RegExp(
  `[${ARABIC_RANGES.map(([lo, hi]) => `${String.fromCodePoint(lo)}-${String.fromCodePoint(hi)}`).join('')}]`,
  'u',
);

function readsAsArabic(text: string): boolean {
  return ARABIC_SCRIPT.test(text);
}

/**
 * Any client identity or client currency that ever lived in this tree. The
 * engine is brand-agnostic: the store name reaches a body as `{{storeName}}`.
 * Each word is spelled with a bracketed last letter so the repository's own
 * client-scrub grep does not match the guard that enforces it.
 */
const CLIENT_TRACE = /den[t]s|al[\s-]?khalee[j]|\bQ[A]R\b|\bT[N]D\b|Tuni[s]|Qata[r]/i;

/** The customer register is neutral: no professional title, no honorific. */
const HONORIFIC = /Docteu[r]|\bDocto[r]\b/;

/** The em dash never appears in copy: a comma, a period, or a rephrase instead. */
const EM_DASH = String.fromCodePoint(0x2014);

/**
 * Flows whose subject is locale-invariant by construction. `contact-form` is
 * `[Contact] {{subjectLine}}`: a routing tag plus the sender's own words, with
 * no copy of ours to translate. The exemption is pinned by asserting the three
 * locales are byte-identical, so it stops applying the moment any side grows
 * real prose.
 */
const LOCALE_NEUTRAL_SUBJECT_FLOWS = new Set(['contact-form']);

describe('TEMPLATE_DEFAULTS shape', () => {
  const registryCodes = Object.keys(TEMPLATE_REGISTRY).sort();

  it('covers exactly the registry flows (no drift vs MailJobName)', () => {
    expect([...MAIL_FLOW_CODES].sort()).toEqual(registryCodes);
    expect(Object.keys(TEMPLATE_DEFAULTS).sort()).toEqual(registryCodes);
  });

  it.each([...MAIL_FLOW_CODES])('%s has a non-empty subject/body in every locale', (code) => {
    const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
    for (const locale of LOCALES) {
      expect(def.subject[locale].trim().length).toBeGreaterThan(0);
      expect(def.body[locale].trim().length).toBeGreaterThan(0);
    }
    expect(def.variables.length).toBeGreaterThan(0);
  });

  it.each([...MAIL_FLOW_CODES])('%s carries exactly the fr+en+ar locale set', (code) => {
    const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
    expect(Object.keys(def.subject)).toEqual([...LOCALES]);
    expect(Object.keys(def.body)).toEqual([...LOCALES]);
  });

  it.each([...MAIL_FLOW_CODES])(
    '%s subject and body tokens are all declared in variables',
    (code) => {
      const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
      const declared = new Set(def.variables);
      for (const locale of LOCALES) {
        for (const text of [def.subject[locale], def.body[locale]]) {
          const tokens = [...text.matchAll(/\{\{+\s*([\w.]+)\s*\}\}+/g)].map((m) => m[1]);
          for (const token of tokens) {
            expect(declared.has(token)).toBe(true);
          }
        }
      }
    },
  );

  // Money variables arrive already formatted for display, so no flow may
  // declare or reference a `currency` variable any more.
  it.each([...MAIL_FLOW_CODES])('%s carries no currency variable', (code) => {
    const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
    expect(def.variables).not.toContain('currency');
    for (const locale of LOCALES) {
      expect(def.body[locale]).not.toContain('{{currency}}');
    }
  });

  /**
   * The store name is a variable, never a literal: every subject and body
   * that names the store interpolates `{{storeName}}`, and no client that
   * ever lived in this tree survives in any locale.
   */
  it.each([...MAIL_FLOW_CODES])('%s carries no client identity in any locale', (code) => {
    const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
    for (const locale of LOCALES) {
      for (const text of [def.subject[locale], def.body[locale]]) {
        expect(text).not.toMatch(CLIENT_TRACE);
      }
    }
  });

  it.each([...MAIL_FLOW_CODES])(
    '%s names the store through {{storeName}} in its subject',
    (code) => {
      if (LOCALE_NEUTRAL_SUBJECT_FLOWS.has(code)) return;
      const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
      for (const locale of LOCALES) {
        expect(def.subject[locale]).toContain('{{storeName}}');
      }
      expect(def.variables).toContain('storeName');
    },
  );

  /**
   * Order, return, tracking and gift-card references render in JetBrains
   * Mono. Checked by subtraction: strip every mono-faced element out of the
   * body, then assert no identifier token survives in what is left. That
   * catches a `<strong>{{orderNumber}}</strong>` and a bare `{{orderNumber}}`
   * alike, and stays true however the sentence around it is reworded.
   *
   * Body only. A subject line is a mail header rather than markup, so an
   * identifier there cannot carry a face at all.
   */
  const IDENTIFIER_TOKENS = ['orderNumber', 'returnNumber', 'trackingNumber', 'code'];
  const MONO_ELEMENT = /<(span|div)[^>]*JetBrains Mono[\s\S]*?>[\s\S]*?<\/\1>/g;

  it.each([...MAIL_FLOW_CODES])('%s sets every identifier in the mono face', (code) => {
    const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
    for (const locale of LOCALES) {
      const outsideMono = def.body[locale].replace(MONO_ELEMENT, '');
      for (const token of IDENTIFIER_TOKENS) {
        expect(outsideMono).not.toContain(`{{${token}}}`);
      }
    }
  });

  // The other half of the same rule: prices are set in tabular numerals, not
  // mono, so the identifiers must not drag the money into the face.
  const MONEY_TOKENS = [
    'total',
    'subtotal',
    'balance',
    'initialBalance',
    'remainingBalance',
    'amountRedeemed',
    'refundAmount',
    'revenue',
    'aov',
  ];

  it.each([...MAIL_FLOW_CODES])('%s keeps money out of the mono face', (code) => {
    const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
    for (const locale of LOCALES) {
      for (const fragment of def.body[locale].match(MONO_ELEMENT) ?? []) {
        for (const token of MONEY_TOKENS) {
          expect(fragment).not.toContain(`{{${token}}}`);
        }
      }
    }
  });

  /**
   * The customer register is neutral in every locale: no professional title,
   * no honorific. Mirrors `templates/registry-render.spec.ts`, because the two
   * tiers drifting apart is the seam this rule exists to close.
   */
  const STAFF_FLOWS = new Set([
    'admin.kpi-digest',
    'admin.ops-digest',
    'admin.staff-invite',
    'contact-form',
  ]);

  it.each([...MAIL_FLOW_CODES])('%s addresses the customer with no honorific', (code) => {
    if (STAFF_FLOWS.has(code)) return;
    const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
    for (const locale of LOCALES) {
      expect(def.body[locale]).not.toMatch(HONORIFIC);
    }
  });

  it.each([...MAIL_FLOW_CODES])('%s carries no em dash in any locale', (code) => {
    const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
    for (const locale of LOCALES) {
      expect(def.subject[locale]).not.toContain(EM_DASH);
      expect(def.body[locale]).not.toContain(EM_DASH);
    }
  });

  /**
   * No displayed price appears without its tax basis. The file tier is pinned
   * on the rendered string; here the money is still a token, so the trigger is
   * a money variable rather than a formatted amount. `TTC` and `HT` carry in
   * French and English, the spelled-out forms in Arabic; the invoice PDF's own
   * column headers are the `excl./incl. VAT` arm.
   */
  const TAX_MENTION = /\bTTC\b|\bHT\b|excl\.\s*VAT|incl\.\s*VAT|شامل الضريبة|دون احتساب الضريبة/;

  it.each([...MAIL_FLOW_CODES])('%s states the tax basis beside every price', (code) => {
    const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
    for (const locale of LOCALES) {
      const body = def.body[locale];
      if (!MONEY_TOKENS.some((token) => body.includes(`{{${token}}}`))) continue;
      expect(body).toMatch(TAX_MENTION);
    }
  });

  /**
   * French sets a no-break space before a colon, in the body as well as the
   * subject. This tier is body-HTML plus a header subject, so the body carries
   * the `&nbsp;` entity and the subject carries the `U+00A0` codepoint;
   * asserting the absence of a plain `space + colon` covers both at once.
   */
  const NO_BREAK_SPACE = String.fromCodePoint(0x00a0);

  it.each([...MAIL_FLOW_CODES])(
    '%s puts a no-break space before a colon in the French copy',
    (code) => {
      const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
      expect(def.subject.fr).not.toContain(' :');
      expect(def.body.fr).not.toContain(' :');
      if (def.subject.fr.includes(':')) {
        expect(def.subject.fr).toContain(`${NO_BREAK_SPACE}:`);
      }
    },
  );

  /**
   * The stronger form of the colon rule, mirroring
   * `templates/registry-render.spec.ts`. Absence of a plain `space + colon`
   * passes on `adresse:` with no space at all. This tier is body HTML plus a
   * header subject, so a colon is preceded by the `&nbsp;` entity in a body
   * and by the codepoint in a subject. URLs and clock times are taken out
   * first: neither `https://` nor `10:15` is punctuation.
   */
  it.each([...MAIL_FLOW_CODES])('%s precedes every French colon correctly', (code) => {
    const def = TEMPLATE_DEFAULTS[code as MailFlowCode];

    // Tags first: inline CSS is full of colons (`font-size:`, `margin:`) and
    // none of it is prose. What is left is the text nodes the reader sees.
    const bodyProse = def.body.fr
      .replace(/<[^>]*>/g, ' ')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\d:\d/g, '');
    const bodyOffenders = [...bodyProse.matchAll(/(.{6}):/g)]
      .map((m) => m[1])
      .filter((before) => !before.endsWith('&nbsp;') && !before.endsWith(NO_BREAK_SPACE));
    expect(bodyOffenders).toEqual([]);

    const subjectProse = def.subject.fr.replace(/https?:\/\/\S+/g, '').replace(/\d:\d/g, '');
    const subjectOffenders = [...subjectProse.matchAll(/(.):/g)]
      .map((m) => m[1])
      .filter((before) => before !== NO_BREAK_SPACE);
    expect(subjectOffenders).toEqual([]);
  });

  /**
   * One apostrophe glyph across both renderer tiers: the straight quote. The
   * pin is what stops a later edit here from drifting away from the file
   * templates, which are pinned the same way in
   * `templates/registry-render.spec.ts`.
   */
  const TYPOGRAPHIC_APOSTROPHE = String.fromCodePoint(0x2019);

  it.each([...MAIL_FLOW_CODES])('%s writes the apostrophe as the straight quote', (code) => {
    const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
    for (const locale of LOCALES) {
      expect(def.subject[locale]).not.toContain(TYPOGRAPHIC_APOSTROPHE);
      expect(def.body[locale]).not.toContain(TYPOGRAPHIC_APOSTROPHE);
    }
  });

  // The checks above all pass on an English string left in the `fr` slot.
  // These say the French copy is actually French, the Arabic copy is actually
  // Arabic, and that the French marker is not one that fires on anything.
  it.each([...MAIL_FLOW_CODES])('%s French copy reads as French', (code) => {
    const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
    expect(readsAsFrench(def.body.fr)).toBe(true);
    if (LOCALE_NEUTRAL_SUBJECT_FLOWS.has(code)) {
      expect(def.subject.fr).toBe(def.subject.en);
      expect(def.subject.fr).toBe(def.subject.ar);
    } else {
      expect(readsAsFrench(def.subject.fr)).toBe(true);
    }
  });

  it.each([...MAIL_FLOW_CODES])('%s Arabic copy reads as Arabic', (code) => {
    const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
    expect(readsAsArabic(def.body.ar)).toBe(true);
    if (!LOCALE_NEUTRAL_SUBJECT_FLOWS.has(code)) {
      expect(readsAsArabic(def.subject.ar)).toBe(true);
    }
  });

  it.each([...MAIL_FLOW_CODES])('%s English and French copy carry no Arabic script', (code) => {
    const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
    for (const locale of ['fr', 'en'] as const) {
      expect(readsAsArabic(def.subject[locale])).toBe(false);
      expect(readsAsArabic(def.body[locale])).toBe(false);
    }
  });

  it.each([...MAIL_FLOW_CODES])('%s English copy trips no French marker', (code) => {
    const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
    expect(readsAsFrench(def.subject.en)).toBe(false);
    expect(readsAsFrench(def.body.en)).toBe(false);
  });

  it.each([...MAIL_FLOW_CODES])(
    '%s carries no leftover layout chrome (body-only block)',
    (code) => {
      const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
      for (const locale of LOCALES) {
        expect(def.body[locale]).not.toContain('<!doctype');
        expect(def.body[locale]).not.toContain('<html');
      }
    },
  );

  /**
   * The seeded CTA block aligns to the reading direction of its locale: right
   * for the right-to-left locale, left for the others. The renderer's own
   * layout reads the runtime config for the surrounding chrome.
   */
  it.each([...MAIL_FLOW_CODES])('%s aligns its CTA block to the locale direction', (code) => {
    const def = TEMPLATE_DEFAULTS[code as MailFlowCode];
    for (const locale of LOCALES) {
      const body = def.body[locale];
      if (!body.includes('<a href="{{{')) continue;
      const expected = locale === 'ar' ? 'text-align:right' : 'text-align:left';
      const forbidden = locale === 'ar' ? 'text-align:left' : 'text-align:right';
      expect(body).toContain(expected);
      expect(body).not.toContain(forbidden);
    }
  });
});

describe('planBackfill (Risk R1, never clobber an operator edit)', () => {
  const def = TEMPLATE_DEFAULTS['order.placed'];

  it('fills an empty body from the default', () => {
    const patch = planBackfill({ body: { fr: '', en: '' }, variables: ['orderNumber'] }, def);
    expect(patch?.body?.fr).toBe(def.body.fr);
    expect(patch?.body?.en).toBe(def.body.en);
    expect(patch?.variables).toBeUndefined();
  });

  it('leaves a non-empty operator body untouched (returns null)', () => {
    const patch = planBackfill(
      {
        body: { fr: '<p>personnalisé</p>', en: '<p>custom en</p>', ar: '<p>مخصص</p>' },
        variables: ['orderNumber'],
      },
      def,
    );
    expect(patch).toBeNull();
  });

  it('fills a locale the row never carried, keeping the operator locales', () => {
    // A row written under a two-locale store gains the third catalogue locale.
    const patch = planBackfill(
      { body: { fr: '<p>personnalisé</p>', en: '<p>custom en</p>' }, variables: ['orderNumber'] },
      def,
    );
    expect(patch?.body).toEqual({
      fr: '<p>personnalisé</p>',
      en: '<p>custom en</p>',
      ar: def.body.ar,
    });
  });

  it('fills only the empty locale (per-locale granularity)', () => {
    const patch = planBackfill(
      { body: { fr: '<p>personnalisé</p>', en: '' }, variables: ['x'] },
      def,
    );
    expect(patch?.body?.fr).toBe('<p>personnalisé</p>');
    expect(patch?.body?.en).toBe(def.body.en);
  });

  it('fills empty variables from the default without touching a full body', () => {
    const patch = planBackfill({ body: { fr: 'x', en: 'y', ar: 'z' }, variables: [] }, def);
    expect(patch?.variables).toEqual(def.variables);
    expect(patch?.body).toBeUndefined();
  });

  it('skips a code with no default (returns null)', () => {
    expect(planBackfill({ body: { fr: '', en: '' }, variables: [] }, undefined)).toBeNull();
  });

  it('treats a whitespace-only body locale as empty', () => {
    const patch = planBackfill({ body: { fr: '   ', en: '\n' }, variables: ['x'] }, def);
    expect(patch?.body?.fr).toBe(def.body.fr);
    expect(patch?.body?.en).toBe(def.body.en);
  });

  it('treats a null/non-object body as fully empty', () => {
    const patch = planBackfill({ body: null, variables: ['x'] }, def);
    expect(patch?.body?.fr).toBe(def.body.fr);
    expect(patch?.body?.en).toBe(def.body.en);
  });
});

describe('backfillNotificationBodies (idempotent runner)', () => {
  function mockPrisma(rows: TemplateRow[]) {
    const update = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      notificationTemplate: {
        findMany: vi.fn().mockResolvedValue(rows),
        update,
      },
    };
    return { prisma, update };
  }

  it('updates only the empty rows; leaves edited + unknown rows alone', async () => {
    const { prisma, update } = mockPrisma([
      { id: '1', code: 'order.placed', body: { fr: '', en: '' }, variables: ['orderNumber'] },
      {
        id: '2',
        code: 'order.shipped',
        body: { fr: '<p>modifié</p>', en: '<p>edited</p>', ar: '<p>معدل</p>' },
        variables: ['orderNumber'],
      },
      { id: '3', code: 'unknown.flow', body: { fr: '', en: '' }, variables: [] },
    ]);
    const result = await backfillNotificationBodies(prisma as never);
    expect(result).toEqual({ total: 3, updated: 1, skipped: 2 });
    expect(update).toHaveBeenCalledTimes(1);
    const [[call]] = update.mock.calls;
    expect(call.where).toEqual({ id: '1' });
    expect(call.data.body.fr).toBe(TEMPLATE_DEFAULTS['order.placed'].body.fr);
    expect(call.data.body.en).toBe(TEMPLATE_DEFAULTS['order.placed'].body.en);
  });

  it('is a no-op on a second run (all rows already filled)', async () => {
    const { prisma, update } = mockPrisma([
      {
        id: '1',
        code: 'order.placed',
        body: {
          fr: TEMPLATE_DEFAULTS['order.placed'].body.fr,
          en: TEMPLATE_DEFAULTS['order.placed'].body.en,
          ar: TEMPLATE_DEFAULTS['order.placed'].body.ar,
        },
        variables: TEMPLATE_DEFAULTS['order.placed'].variables,
      },
    ]);
    const result = await backfillNotificationBodies(prisma as never);
    expect(result).toEqual({ total: 1, updated: 0, skipped: 1 });
    expect(update).not.toHaveBeenCalled();
  });
});
