/**
 * Registry-wide render sweep.
 *
 * Drives every flow in `TEMPLATE_REGISTRY` across every locale in
 * `MAIL_LOCALES`, so a broken template literal, a mistyped variable or a
 * missing locale entry in any of the 36 flows fails here without anyone
 * remembering to add a test. A flow added later is swept for free.
 *
 * One shared bag of sample variables serves all flows: each renderer reads only
 * the keys its own `Vars` declares, so the union of the 36 `Vars` shapes is a
 * valid input for every one of them. A flow that reads a key the bag does not
 * carry surfaces as a literal `undefined` in the output, which is asserted
 * against.
 *
 * The store name is injected, never a literal (DR-31): every subject and every
 * html body must carry the name the caller passed in.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { NEUTRAL_LOCALE_SET, storeLocales } from '@common/locale';
import { TEMPLATE_REGISTRY } from './registry';
import { MONEY, SAMPLE_VARS } from './sample-vars';
import { SALUTATION_ALONE, STAFF_FLOWS } from './copy-rules';
import { MAIL_LOCALES, type MailBrand, type MailJobName, type MailLocale } from '../mail.types';

const NARROW_NO_BREAK_SPACE = String.fromCodePoint(0x202f);
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0);

/** The store name every render below is handed. Capitalised on purpose. */
const BRAND: MailBrand = { storeName: 'Maison Exemple' };

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

/**
 * The typographic apostrophe, built from its codepoint rather than pasted.
 * One glyph across the corpus, the straight `'`, so the two tiers of a flow
 * cannot render the same French sentence two different ways.
 */
const TYPOGRAPHIC_APOSTROPHE = String.fromCodePoint(0x2019);

/** The em dash, forbidden in copy: a comma, a period, or a rephrase instead. */
const EM_DASH = String.fromCodePoint(0x2014);

/**
 * Any client identity or client currency that ever lived in this tree. The
 * engine is brand-agnostic: a store name reaches a template as a variable.
 * Each word is spelled with a bracketed last letter so the repository's own
 * client-scrub grep does not match the guard that enforces it.
 */
const CLIENT_TRACE = /den[t]s|al[\s-]?khalee[j]|\bQ[A]R\b|\bT[N]D\b|Tuni[s]|Qata[r]/i;

/** The customer register is neutral: no professional title, no honorific. */
const HONORIFIC = /Docteu[r]|\bDocto[r]\b/;

/** Leftover `{{token}}` / `{{{token}}}` the interpolator never replaced. */
const UNREPLACED_TOKEN = /\{\{/;

/**
 * Urgency and promotional escalation, all three languages. Asserted on the
 * subject and the plain text part only: the html carries `<!doctype html>`,
 * whose exclamation mark is markup rather than copy.
 */
const FORBIDDEN_COPY: ReadonlyArray<readonly [string, RegExp]> = [
  ['exclamation mark', /!/],
  ['em dash', new RegExp(EM_DASH)],
  ['countdown, fr', /derni(?:ers|ères)\s+(?:jours|heures)|derni[eè]re\s+chance/i],
  [
    'scarcity, fr',
    /plus\s+que\s+\d|il\s+ne\s+reste\s+(?:que|plus)|d[ée]p[êe]chez|ne\s+manquez\s+pas/i,
  ],
  [
    'promotional escalation, fr',
    /imbattable|offre\s+exceptionnelle|incontournable|r[ée]volutionnaire|ultra[\s-]rapide|\bleader\b|n[°o]\s?1\b/i,
  ],
  ['countdown, en', /last\s+(?:chance|hours|days)|ends\s+(?:today|tonight|soon)|limited\s+time/i],
  ['scarcity, en', /only\s+\d+\s+left|hurry|act\s+now|do\s?n[o']t\s+miss/i],
  [
    'promotional escalation, en',
    /unbeatable|exclusive\s+offer|revolutionary|must[\s-]have|best\s+price|shop\s+now|#1\b/i,
  ],
  ['scarcity, ar', /قبل نفاد|تنفد بسرعة|لا تفوت|سارع|آخر فرصة|عرض حصري/],
];

/**
 * No displayed price without a tax mention. `TTC` / `HT` in French and
 * English, the spelled-out forms in Arabic; the English column forms exist for
 * the invoice's table headers.
 */
const TAX_MENTION = /\bTTC\b|\bHT\b|excl\.\s*VAT|incl\.\s*VAT|شامل الضريبة|دون احتساب الضريبة/;

/**
 * Order, return and tracking numbers render in the mono face. The money half
 * of the rule is asserted alongside on purpose: prices are set in tabular
 * numerals, NOT mono, so "identifiers are mono" and "money is not" are one
 * rule with two halves.
 */
const IDENTIFIER_VARS = ['orderNumber', 'returnNumber', 'trackingNumber'] as const;

/**
 * The text inside every mono-faced element in a rendered body: the inline
 * `monoId` span and the standalone `codeBlock` div, which are the only two
 * places the face is allowed to appear.
 */
const MONO_ELEMENT = /<(span|div)[^>]*JetBrains Mono[\s\S]*?>([\s\S]*?)<\/\1>/g;

function monoFragments(html: string): string[] {
  return [...html.matchAll(MONO_ELEMENT)].map((m) => m[2]);
}

/** The text inside every `<strong>` in a rendered body. */
function strongFragments(html: string): string[] {
  return [...html.matchAll(/<strong>([\s\S]*?)<\/strong>/g)].map((m) => m[1]);
}

const FLOWS = Object.keys(TEMPLATE_REGISTRY) as MailJobName[];

/** Every flow x every locale, so a new flow or a new locale is swept for free. */
const PAIRS: ReadonlyArray<readonly [MailJobName, MailLocale]> = FLOWS.flatMap((code) =>
  MAIL_LOCALES.map((locale) => [code, locale] as const),
);

/**
 * `contact-form` is the one subject with no copy of ours in it: a routing tag
 * plus the sender's own words, so the store name has no place there.
 */
const STORE_NAME_FREE_SUBJECTS: ReadonlySet<MailJobName> = new Set(['contact-form']);

describe('TEMPLATE_REGISTRY render sweep', () => {
  it('sweeps every registered flow in every mail locale', () => {
    expect(FLOWS.length).toBeGreaterThan(0);
    expect([...MAIL_LOCALES].sort()).toEqual(['ar', 'en', 'fr']);
    expect(PAIRS).toHaveLength(FLOWS.length * MAIL_LOCALES.length);
  });

  describe.each(PAIRS)('%s / %s', (code, locale) => {
    const rendered = TEMPLATE_REGISTRY[code](locale, SAMPLE_VARS, BRAND);
    const { subject, html, text } = rendered;
    // The html carries `<!doctype html>`; copy rules apply to prose only.
    const copyParts: ReadonlyArray<readonly [string, string]> = [
      ['subject', subject],
      ['text', text],
    ];
    const allParts: ReadonlyArray<readonly [string, string]> = [...copyParts, ['html', html]];

    it('renders a non-empty subject and plain-text part', () => {
      expect(subject.trim()).not.toBe('');
      expect(text.trim()).not.toBe('');
      expect(html.trim()).not.toBe('');
    });

    it.each(allParts)('leaves no unrendered value in the %s', (_part, value) => {
      expect(value).not.toContain('undefined');
      expect(value).not.toContain('[object Object]');
      expect(value).not.toContain('NaN');
      expect(value).not.toMatch(UNREPLACED_TOKEN);
    });

    it.each(allParts)('writes the apostrophe as the straight quote in the %s', (_part, value) => {
      expect(value).not.toContain(TYPOGRAPHIC_APOSTROPHE);
    });

    /**
     * The script matches the locale: Arabic copy is written in Arabic, and
     * the Latin locales carry none of it. Checked on the subject and the text
     * arm, the two parts made of copy alone.
     */
    it.each(copyParts)('writes the %s in the script of the locale', (part, value) => {
      if (part === 'subject' && STORE_NAME_FREE_SUBJECTS.has(code)) return;
      if (locale === 'ar') {
        expect(value).toMatch(ARABIC_SCRIPT);
      } else {
        expect(value).not.toMatch(ARABIC_SCRIPT);
      }
    });

    it.each(allParts)('carries no trace of any client in the %s', (_part, value) => {
      expect(value).not.toMatch(CLIENT_TRACE);
    });

    it('prints the injected store name in the subject and the html', () => {
      expect(html).toContain(BRAND.storeName);
      if (!STORE_NAME_FREE_SUBJECTS.has(code)) {
        expect(subject).toContain(BRAND.storeName);
      }
    });

    it('heads the message with a noun phrase, never a salutation', () => {
      const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.trim() ?? '';
      expect(heading).not.toBe('');
      expect(heading).not.toMatch(SALUTATION_ALONE);
    });

    /**
     * The customer register is neutral: no professional title, no honorific,
     * in any locale. Mirrored in
     * `prisma/__tests__/notification-template-defaults.spec.ts`, because the
     * two tiers drifting apart is the seam this rule exists to close.
     */
    it('addresses the customer with no honorific', () => {
      if (STAFF_FLOWS.has(code)) return;
      expect(html).not.toMatch(HONORIFIC);
    });

    it('never renders the salutation as a paragraph of its own', () => {
      const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1].trim());
      for (const paragraph of paragraphs) {
        expect(paragraph).not.toMatch(SALUTATION_ALONE);
      }
    });

    /**
     * `href` values are blanked first: `orderUrl` embeds the order number, and
     * an identifier inside a link target is not the identifier written in
     * prose.
     */
    const prose = html.replace(/href="[^"]*"/g, 'href=""');

    it.each(IDENTIFIER_VARS)('sets %s in the mono face, never in <strong>', (key) => {
      const value = String(SAMPLE_VARS[key]);
      if (!prose.includes(value)) return;
      expect(monoFragments(prose).some((f) => f.includes(value))).toBe(true);
      expect(strongFragments(prose).some((f) => f.includes(value))).toBe(false);
    });

    it('keeps money out of the mono face (tabular numerals, not mono)', () => {
      for (const fragment of monoFragments(prose)) {
        expect(fragment).not.toContain(MONEY);
      }
    });

    describe.each(copyParts)('%s copy rules', (_part, value) => {
      it.each(FORBIDDEN_COPY)('carries no %s', (_label, pattern) => {
        expect(value).not.toMatch(pattern);
      });
    });

    /**
     * French sets a no-break space before a colon, in every part rather than in
     * the subject alone. An HTML body carries the `&nbsp;` entity; a subject is
     * a mail header and a plain-text arm is read as typed, so both carry the
     * `U+00A0` codepoint. Asserting the absence of a plain `space + colon`
     * covers all three at once, whichever form the part is entitled to use.
     */
    it.each(allParts)('puts a no-break space before a colon in the French %s', (_part, value) => {
      if (locale !== 'fr') return;
      expect(value).not.toContain(' :');
    });

    /**
     * The stronger form of the same rule. Asserting only the absence of a plain
     * `space + colon` passes on `adresse:` with no space at all. Every colon in
     * French copy must be preceded by the no-break space, once URLs and clock
     * times are taken out: a URL carries `https://` and a time carries `10:15`,
     * and neither is punctuation.
     */
    it('precedes every French colon with the no-break space', () => {
      if (locale !== 'fr') return;
      for (const [, value] of copyParts) {
        const prose = value.replace(/https?:\/\/\S+/g, '').replace(/\d:\d/g, '');
        const offending = [...prose.matchAll(/(.):/g)]
          .map((m) => m[1])
          .filter((before) => before !== NO_BREAK_SPACE);
        expect(offending).toEqual([]);
      }

      // The html arm too, with tags stripped: inline CSS is full of colons and
      // none of it is prose. A body carries the entity where the header and the
      // text arm carry the codepoint, so both forms are accepted here.
      const htmlProse = html
        .replace(/<[^>]*>/g, ' ')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\d:\d/g, '');
      const htmlOffenders = [...htmlProse.matchAll(/(.{6}):/g)]
        .map((m) => m[1])
        .filter((before) => !before.endsWith('&nbsp;') && !before.endsWith(NO_BREAK_SPACE));
      expect(htmlOffenders).toEqual([]);
    });

    it('writes the French subject colon as the codepoint, not the entity', () => {
      if (locale !== 'fr') return;
      expect(subject).not.toContain('&nbsp;');
      if (subject.includes(':')) expect(subject).toContain(`${NO_BREAK_SPACE}:`);
    });

    it('leaves no HTML entity in the plain-text arm', () => {
      expect(text).not.toContain('&nbsp;');
    });

    it.each(allParts)('states the tax basis beside every price in the %s', (_part, value) => {
      if (!value.includes(MONEY)) return;
      expect(value).toMatch(TAX_MENTION);
    });
  });
});

/**
 * Direction follows the store's locale set, never the locale code. A store
 * that enables a right-to-left locale gets `dir="rtl"` and right-aligned
 * blocks for it; every other locale stays left-to-right. The snapshot is
 * process-wide, so it is restored after each case.
 */
describe('layout direction follows the store locale set', () => {
  afterEach(() => {
    storeLocales.set(NEUTRAL_LOCALE_SET);
  });

  it.each(FLOWS)('%s composes rtl for ar and ltr for en under a gulf set', (code) => {
    storeLocales.set({
      supportedLocales: ['ar', 'en'],
      defaultLocale: 'ar',
      rtlLocales: ['ar'],
      timezone: 'UTC',
    });

    const ar = TEMPLATE_REGISTRY[code]('ar', SAMPLE_VARS, BRAND).html;
    expect(ar).toContain('dir="rtl"');
    expect(ar).toContain('lang="ar"');
    expect(ar).toContain('text-align:right');
    expect(ar).not.toContain('text-align:left');

    const en = TEMPLATE_REGISTRY[code]('en', SAMPLE_VARS, BRAND).html;
    expect(en).toContain('dir="ltr"');
    expect(en).toContain('lang="en"');
    expect(en).not.toMatch(/rtl/i);
    expect(en).not.toContain('text-align:right');
  });

  it('composes ar left-to-right when the store does not mark it rtl', () => {
    storeLocales.set({
      supportedLocales: ['fr', 'ar'],
      defaultLocale: 'fr',
      rtlLocales: [],
      timezone: 'UTC',
    });
    const ar = TEMPLATE_REGISTRY['order.placed']('ar', SAMPLE_VARS, BRAND).html;
    expect(ar).toContain('dir="ltr"');
    expect(ar).not.toContain('text-align:right');
  });
});

/**
 * Source-byte guard for the whole copy surface, both tiers.
 *
 * A raw `U+0008` where `\b` belongs in a regex, or a typed `U+00A0` instead
 * of one built from its codepoint, is invisible in a diff and unreachable
 * from a rendered string. This reads the sources instead.
 */
describe('copy sources carry no invisible characters', () => {
  const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..');
  const ROOTS = [
    join(__dirname),
    join(__dirname, '..', '..', 'campaigns'),
    join(__dirname, '..', '..', 'notifications'),
    join(__dirname, '..', '..', 'orders'),
    join(REPO_ROOT, 'prisma', 'notification-template-defaults.ts'),
  ];

  function tsFiles(root: string): string[] {
    if (!statSync(root).isDirectory()) return [root];
    return readdirSync(root)
      .map((name) => join(root, name))
      .flatMap((p) => (statSync(p).isDirectory() ? [] : p.endsWith('.ts') ? [p] : []));
  }

  const FILES = ROOTS.flatMap(tsFiles);

  /** A typed U+00A0 or U+202F, built from codepoints so this line is clean. */
  const TYPED_SPACE = new RegExp(`[${NO_BREAK_SPACE}${NARROW_NO_BREAK_SPACE}]`);

  it('sweeps a non-empty set of sources', () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  it.each(FILES)('%s carries no raw control byte', (file) => {
    const bytes = readFileSync(file);
    const offending = [...bytes].filter(
      (b) => b < 0x09 || (b > 0x0a && b < 0x0d) || (b > 0x0d && b < 0x20),
    );
    expect(offending).toEqual([]);
  });

  it.each(FILES)('%s builds a no-break space from its codepoint', (file) => {
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');
    const typed = lines
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => TYPED_SPACE.test(line) && !/fromCodePoint/.test(line))
      .map(([n, line]) => `${n}: ${line.trim()}`);
    expect(typed).toEqual([]);
  });
});
