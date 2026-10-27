/**
 * Specs for the two-tier template resolver (NE0.3, updated by NE1, retargeted
 * for the brand-agnostic engine).
 *
 * NE1 split the conflated `isEnabled` flag: the kill-switch is now
 * `sendEnabled` (read by MailService.enqueue, never here), and content
 * selection is keyed PURELY on a non-empty subject + body. The legacy
 * `isEnabled` column no longer governs which tier renders. These specs lock:
 *   - a DB row with a non-empty subject + body wins regardless of `isEnabled`
 *   - every fall-through path (empty body / no row / empty-locale shape)
 *   - the throw when neither DB row nor file fallback can render
 *   - the tiny interpolator: `{{escaped}}` vs `{{{raw}}}` vs unknown/non-word tokens
 *   - `pickLocale` resolution order: locale, store default, `default`, ''
 *   - the store name reaches both tiers from the caller, never from a literal
 *   - the composed layout's direction follows the store locale set
 */
import { FR_EN_LOCALE_SET, NEUTRAL_LOCALE_SET, storeLocales } from '@common/locale';
import { interpolate, pickLocale, renderDraft, renderTemplate } from './render';
import { TEMPLATE_REGISTRY } from './registry';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { MailJobName } from '../mail.types';

/** No-break space, the separator between an amount and its symbol. */
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0);

const STORE = 'Maison Exemple';
const OPTS = { storeName: STORE };

function makePrisma() {
  const findUnique = jest.fn();
  const prisma = { notificationTemplate: { findUnique } } as unknown as PrismaService;
  return { prisma, findUnique };
}

describe('interpolate', () => {
  it('HTML-escapes a {{var}} value', () => {
    expect(interpolate('Hi {{name}}', { name: `<b>&"'` })).toBe('Hi &lt;b&gt;&amp;&quot;&#39;');
  });

  it('does NOT escape a {{{raw}}} value (use for href URLs)', () => {
    expect(interpolate('{{{url}}}', { url: '<a href="x">' })).toBe('<a href="x">');
  });

  it('resolves {{{raw}}} before {{escaped}} in a mixed template', () => {
    expect(interpolate('{{{a}}} {{b}}', { a: '<i>', b: '<i>' })).toBe('<i> &lt;i&gt;');
  });

  it('replaces an unknown {{var}} with an empty string', () => {
    expect(interpolate('a{{missing}}b', {})).toBe('ab');
  });

  it('passes a non-word token like {{a-b}} through untouched', () => {
    expect(interpolate('{{a-b}}', {})).toBe('{{a-b}}');
  });
});

describe('pickLocale: locale, store default, default, ""', () => {
  afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

  it('takes the requested locale when it carries copy', () => {
    expect(pickLocale({ fr: 'FR', en: 'EN', ar: 'AR' }, 'en')).toBe('EN');
    expect(pickLocale({ fr: 'FR', en: 'EN', ar: 'AR' }, 'fr')).toBe('FR');
    expect(pickLocale({ fr: 'FR', en: 'EN', ar: 'AR' }, 'ar')).toBe('AR');
  });

  it('falls back to the store default locale, not to a fixed language', () => {
    storeLocales.set(FR_EN_LOCALE_SET);
    expect(pickLocale({ fr: 'FR only' }, 'en')).toBe('FR only');
    expect(pickLocale({ en: 'EN only' }, 'fr')).toBe('');

    storeLocales.set({
      supportedLocales: ['ar', 'en'],
      defaultLocale: 'ar',
      rtlLocales: ['ar'],
      timezone: 'UTC',
    });
    expect(pickLocale({ ar: 'AR only' }, 'en')).toBe('AR only');
    expect(pickLocale({ fr: 'FR only' }, 'en')).toBe('');
  });

  it('takes the default rung when neither the locale nor the store default carries copy', () => {
    expect(pickLocale({ default: 'D' }, 'en')).toBe('D');
  });

  it('yields empty for a shape carrying no rung at all', () => {
    expect(pickLocale({ es: 'ES' }, 'fr')).toBe('');
    expect(pickLocale(null, 'fr')).toBe('');
  });
});

describe('renderDraft', () => {
  it('exposes the store name to the copy as {{storeName}} and prints it in the chrome', () => {
    const out = renderDraft({
      subject: { en: 'Welcome to {{storeName}}' },
      body: { en: '<p>Thanks from {{storeName}}</p>' },
      locale: 'en',
      variables: {},
      storeName: STORE,
    });
    expect(out.subject).toBe(`Welcome to ${STORE}`);
    expect(out.html).toContain(`<p>Thanks from ${STORE}</p>`);
    expect(out.html).toContain(`<title>${STORE}</title>`);
    expect(out.text).toBe(`Thanks from ${STORE}`);
  });

  it('escapes a store name carrying markup in the html chrome and copy', () => {
    const out = renderDraft({
      subject: { en: 'S' },
      body: { en: '<p>From {{storeName}}</p>' },
      locale: 'en',
      variables: {},
      storeName: 'Tom & <b>Jerry</b>',
    });
    expect(out.html).toContain('<p>From Tom &amp; &lt;b&gt;Jerry&lt;/b&gt;</p>');
    expect(out.html).toContain('<title>Tom &amp; &lt;b&gt;Jerry&lt;/b&gt;</title>');
    expect(out.html).not.toContain('<b>Jerry</b>');
  });

  it('renders an empty store name when a caller has not been wired yet', () => {
    const out = renderDraft({
      subject: { en: 'S {{storeName}}' },
      body: { en: '<p>B</p>' },
      locale: 'en',
      variables: {},
    });
    expect(out.subject).toBe('S ');
    expect(out.html).toContain('<title></title>');
  });
});

describe('renderTemplate', () => {
  let prisma: PrismaService;
  let findUnique: jest.Mock;

  beforeEach(() => {
    ({ prisma, findUnique } = makePrisma());
  });

  afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

  // A complete order.placed variable set, the file fallback's renderText()
  // calls .trim() on every line, so a fall-through path needs all vars present.
  // `total` is already display-formatted by the resolver; there is no separate
  // `currency` variable any more.
  const fullVars = {
    orderNumber: 'A1',
    customerName: 'Sam',
    total: `100,000${NO_BREAK_SPACE}€`,
    itemCount: 2,
    orderUrl: 'https://example.test/account/orders/A1',
  };

  it('DB row wins when isEnabled + subject + body resolve non-empty', async () => {
    findUnique.mockResolvedValue({
      code: 'order.placed',
      isEnabled: true,
      subject: { fr: 'Bonjour {{name}}', en: 'Hi {{name}}' },
      body: { fr: '<p>Commande {{orderNumber}}</p>', en: '<p>Order {{orderNumber}}</p>' },
    });

    const result = await renderTemplate(
      prisma,
      'order.placed',
      'en',
      { name: '<b>', orderNumber: 'A1' },
      OPTS,
    );

    expect(result.subject).toBe('Hi &lt;b&gt;');
    // NE3: the DB body is the inner block, composed into the brand layout here.
    expect(result.html).toContain('<p>Order A1</p>');
    expect(result.html).toContain('<!doctype html>');
    expect(result.html).toContain('dir="ltr"');
  });

  it('prints the injected store name in the DB-tier chrome and copy', async () => {
    findUnique.mockResolvedValue({
      code: 'order.placed',
      isEnabled: true,
      subject: { en: 'Order from {{storeName}}' },
      body: { en: '<p>Thanks, {{storeName}}</p>' },
    });

    const result = await renderTemplate(prisma, 'order.placed', 'en', {}, OPTS);

    expect(result.subject).toBe(`Order from ${STORE}`);
    expect(result.html).toContain(`<p>Thanks, ${STORE}</p>`);
    expect(result.html).toContain(`<title>${STORE}</title>`);
    expect(result.html).toContain(`Sent by ${STORE}.`);
  });

  it('derives plain text by dropping <style>, stripping tags, collapsing whitespace', async () => {
    findUnique.mockResolvedValue({
      code: 'order.placed',
      isEnabled: true,
      subject: { en: 'S' },
      body: { en: '<style>.x{color:red}</style><p>Order   {{id}}</p>\n<b>Done</b>' },
    });

    const result = await renderTemplate(prisma, 'order.placed', 'en', { id: '42' }, OPTS);

    expect(result.text).toBe('Order 42 Done');
  });

  it('NE3: plain text surfaces an <a href> URL as "label (url)"', async () => {
    findUnique.mockResolvedValue({
      code: 'order.placed',
      isEnabled: true,
      subject: { en: 'S' },
      body: { en: '<p>Done.</p><a href="https://example.test/o/1">View order</a>' },
    });

    const result = await renderTemplate(prisma, 'order.placed', 'en', {}, OPTS);

    expect(result.text).toContain('View order (https://example.test/o/1)');
  });

  it('NE3: plain text is derived from the inner block, layout chrome never leaks in', async () => {
    findUnique.mockResolvedValue({
      code: 'order.placed',
      isEnabled: true,
      subject: { en: 'S' },
      body: { en: '<p>Hello there</p>' },
    });

    const result = await renderTemplate(prisma, 'order.placed', 'en', {}, OPTS);

    // The wrapped html carries the header/footer chrome, with the store name.
    expect(result.html).toContain(STORE);
    // The plain-text part is just the body content.
    expect(result.text).toBe('Hello there');
  });

  it('NE3: plain text separates abutting blocks with a space (no run-together words)', async () => {
    findUnique.mockResolvedValue({
      code: 'order.placed',
      isEnabled: true,
      subject: { en: 'S' },
      body: { en: '<h1>Reset your password</h1><p>Click the button below.</p>' },
    });

    const result = await renderTemplate(prisma, 'order.placed', 'en', {}, OPTS);

    expect(result.text).toBe('Reset your password Click the button below.');
  });

  it('DB row with a non-empty body wins regardless of the legacy isEnabled flag (NE1)', async () => {
    // Pre-NE1 this fell through to the file fallback; the kill-switch now lives
    // in enqueue (sendEnabled), so content selection ignores `isEnabled`.
    findUnique.mockResolvedValue({
      code: 'order.placed',
      isEnabled: false,
      subject: { en: 'DB SUBJECT' },
      body: { en: '<p>DB BODY</p>' },
    });

    const result = await renderTemplate(prisma, 'order.placed', 'en', fullVars, OPTS);

    expect(result.subject).toBe('DB SUBJECT');
    expect(result.html).toContain('<p>DB BODY</p>');
    expect(result.html).toContain('<!doctype html>');
  });

  it('falls through when the DB row is enabled but the body is empty', async () => {
    findUnique.mockResolvedValue({
      code: 'order.placed',
      isEnabled: true,
      subject: { fr: 'DB SUJET', en: 'DB SUBJECT' },
      body: { fr: '', en: '' },
    });

    const result = await renderTemplate(prisma, 'order.placed', 'en', fullVars, OPTS);

    expect(result).toEqual(TEMPLATE_REGISTRY['order.placed']('en', fullVars, OPTS));
  });

  it('falls through when there is no DB row, handing the store name to the file tier', async () => {
    findUnique.mockResolvedValue(null);

    const result = await renderTemplate(prisma, 'order.placed', 'en', fullVars, OPTS);

    expect(result).toEqual(TEMPLATE_REGISTRY['order.placed']('en', fullVars, OPTS));
    expect(result.subject).toContain(STORE);
    expect(result.html).toContain(STORE);
  });

  it('DB wins on a {default:..} shape: the default rung is on the chain', async () => {
    findUnique.mockResolvedValue({
      code: 'order.placed',
      isEnabled: true,
      subject: { default: 'DB SUBJECT' },
      body: { default: '<p>DB BODY</p>' },
    });

    const result = await renderTemplate(prisma, 'order.placed', 'en', fullVars, OPTS);

    expect(result.subject).toBe('DB SUBJECT');
    expect(result.html).toContain('<p>DB BODY</p>');
  });

  it('pickLocale: a fr request selects the fr copy', async () => {
    findUnique.mockResolvedValue({
      code: 'order.placed',
      isEnabled: true,
      subject: { fr: 'FR-S {{x}}', en: 'EN-S' },
      body: { fr: '<p>FR</p>', en: '<p>EN</p>' },
    });

    const result = await renderTemplate(prisma, 'order.placed', 'fr', { x: '1' }, OPTS);

    expect(result.subject).toBe('FR-S 1');
    expect(result.html).toContain('<p>FR</p>');
    expect(result.html).toContain('lang="fr"');
  });

  it('pickLocale: an en request falls back to the store default (fr) copy', async () => {
    storeLocales.set(FR_EN_LOCALE_SET);
    findUnique.mockResolvedValue({
      code: 'order.placed',
      isEnabled: true,
      subject: { fr: 'FR-S' },
      body: { fr: '<p>FR</p>' },
    });

    const result = await renderTemplate(prisma, 'order.placed', 'en', {}, OPTS);

    expect(result.subject).toBe('FR-S');
    expect(result.html).toContain('<p>FR</p>');
    // The copy falls back to the store default and so does the chrome, so the
    // message is wholly in one language (DR-33).
    expect(result.html).toContain('lang="fr"');
    expect(result.html).toContain('Cette adresse ne reçoit pas de réponse.');
  });

  it('pickLocale: a fr request with only en copy falls through to the file tier', async () => {
    // en is not the store default under the neutral set, so the DB row yields
    // empty and the compile-checked fallback renders in French.
    findUnique.mockResolvedValue({
      code: 'order.placed',
      isEnabled: true,
      subject: { en: 'EN-S' },
      body: { en: '<p>EN</p>' },
    });

    const result = await renderTemplate(prisma, 'order.placed', 'fr', fullVars, OPTS);

    expect(result).toEqual(TEMPLATE_REGISTRY['order.placed']('fr', fullVars, OPTS));
    expect(result.html).toContain('Cette adresse ne reçoit pas de réponse.');
  });

  it('pickLocale: an ar request picks the ar copy when the store enables it', async () => {
    storeLocales.set({
      supportedLocales: ['ar', 'en'],
      defaultLocale: 'ar',
      rtlLocales: ['ar'],
      timezone: 'UTC',
    });
    findUnique.mockResolvedValue({
      code: 'order.placed',
      isEnabled: true,
      subject: { en: 'EN-S', ar: 'AR-S' },
      body: { en: '<p>EN</p>', ar: '<p>AR</p>' },
    });

    const result = await renderTemplate(prisma, 'order.placed', 'ar', {}, OPTS);

    expect(result.subject).toBe('AR-S');
    expect(result.html).toContain('<p>AR</p>');
    expect(result.html).toContain('lang="ar"');
    expect(result.html).toContain('هذا العنوان لا يستقبل الردود.');
  });

  it('pickLocale: a null subject (while enabled) resolves empty and falls through', async () => {
    // Exercises the `if (!t) return ''` guard through the DB-wins path.
    findUnique.mockResolvedValue({
      code: 'order.placed',
      isEnabled: true,
      subject: null,
      body: { en: '<p>DB BODY</p>' },
    });

    const result = await renderTemplate(prisma, 'order.placed', 'en', fullVars, OPTS);

    expect(result).toEqual(TEMPLATE_REGISTRY['order.placed']('en', fullVars, OPTS));
  });

  it('pickLocale: a bare-string subject + body are used verbatim (DB wins)', async () => {
    // Translatable admits a plain string, exercises the `typeof t === "string"` branch.
    findUnique.mockResolvedValue({
      code: 'order.placed',
      isEnabled: true,
      subject: 'Plain {{x}}',
      body: '<p>{{y}}</p>',
    });

    const result = await renderTemplate(prisma, 'order.placed', 'en', { x: 'S', y: 'B' }, OPTS);

    expect(result.subject).toBe('Plain S');
    expect(result.html).toContain('<p>B</p>');
  });

  it('throws loudly when neither a DB row nor a file fallback can render', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      renderTemplate(prisma, 'does.not.exist' as MailJobName, 'en', {}, OPTS),
    ).rejects.toThrow('no fallback registered');
  });

  // ── Direction follows the store locale set, in both tiers ──────────────────
  it('composes the DB tier rtl for a locale the store marks rtl, ltr otherwise', async () => {
    storeLocales.set({
      supportedLocales: ['ar', 'en'],
      defaultLocale: 'ar',
      rtlLocales: ['ar'],
      timezone: 'UTC',
    });
    findUnique.mockResolvedValue({
      code: 'order.placed',
      isEnabled: true,
      subject: { ar: 'S', en: 'S' },
      body: { ar: '<p>نص</p>', en: '<p>body</p>' },
    });

    const ar = await renderTemplate(prisma, 'order.placed', 'ar', {}, OPTS);
    expect(ar.html).toContain('dir="rtl"');
    expect(ar.html).toContain('lang="ar"');
    expect(ar.html).toContain('text-align:right');

    const en = await renderTemplate(prisma, 'order.placed', 'en', {}, OPTS);
    expect(en.html).toContain('dir="ltr"');
    expect(en.html).toContain('lang="en"');
    expect(en.html).not.toContain('rtl');
    expect(en.html).not.toContain('text-align:right');
  });

  it('composes the file-fallback tier by the same rule', async () => {
    storeLocales.set({
      supportedLocales: ['ar', 'en'],
      defaultLocale: 'ar',
      rtlLocales: ['ar'],
      timezone: 'UTC',
    });
    findUnique.mockResolvedValue(null);

    const ar = await renderTemplate(prisma, 'order.placed', 'ar', fullVars, OPTS);
    const en = await renderTemplate(prisma, 'order.placed', 'en', fullVars, OPTS);

    expect(ar.html).toContain('dir="rtl"');
    expect(en.html).toContain('dir="ltr"');
    expect(en.html).not.toContain('rtl');
  });

  it('keeps every locale left-to-right under the neutral set', async () => {
    findUnique.mockResolvedValue(null);

    const fr = await renderTemplate(prisma, 'order.placed', 'fr', fullVars, OPTS);
    const en = await renderTemplate(prisma, 'order.placed', 'en', fullVars, OPTS);

    expect(fr.html).toContain('dir="ltr"');
    expect(en.html).toContain('dir="ltr"');
    expect(fr.html).not.toContain('rtl');
    expect(en.html).not.toContain('rtl');
  });

  // ── NE7: unsubscribe footer threading ──────────────────────────────────────
  it('renders an unsubscribe footer link when renderTemplate is given a URL', async () => {
    findUnique.mockResolvedValue({
      code: 'cart.abandoned',
      isEnabled: true,
      subject: { en: 'Cart' },
      body: { en: '<p>Body</p>' },
    });

    const url = 'https://api.example.test/api/v1/unsubscribe?token=abc';
    const withUrl = await renderTemplate(
      prisma,
      'cart.abandoned',
      'en',
      {},
      { ...OPTS, unsubscribeUrl: url },
    );
    expect(withUrl.html).toContain(url);
    expect(withUrl.html).toContain('Unsubscribe');

    const without = await renderTemplate(prisma, 'cart.abandoned', 'en', {}, OPTS);
    expect(without.html).not.toContain('/v1/unsubscribe');
  });

  it('localizes the unsubscribe footer link for fr', async () => {
    findUnique.mockResolvedValue({
      code: 'cart.abandoned',
      isEnabled: true,
      subject: { fr: 'Votre panier' },
      body: { fr: '<p>contenu</p>' },
    });
    const out = await renderTemplate(
      prisma,
      'cart.abandoned',
      'fr',
      {},
      { ...OPTS, unsubscribeUrl: 'https://api.example.test/api/v1/unsubscribe?token=t' },
    );
    expect(out.html).toContain('Se désabonner');
  });
});
