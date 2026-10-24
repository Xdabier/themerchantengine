import { WinbackProcessor, isoWeekKey } from './winback.processor';
import { SALUTATION_ALONE } from '../mail/templates/copy-rules';
import {
  WINBACK_DEFAULT_SUBJECT,
  WINBACK_DEFAULT_BODY,
  type Translatable,
} from './winback-defaults';
import { type MailLocale } from '../mail/mail.types';
import { interpolate } from '../mail/templates/render';

/**
 * The locales the win-back defaults actually declare. The engine catalogue
 * is wider; the copy here is swept for what it ships, and a locale it lacks
 * is a copy gap in `winback-defaults.ts`, not a render defect.
 */
const DECLARED_LOCALES = Object.keys(WINBACK_DEFAULT_SUBJECT) as Array<keyof Translatable>;

function makePrisma() {
  return {
    campaign: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'wb1' }),
    },
  };
}

function makeConfig(values: Record<string, string> = {}) {
  return { get: jest.fn((k: string, d?: string) => values[k] ?? d) };
}

describe('isoWeekKey', () => {
  it('formats an ISO week stamp', () => {
    expect(isoWeekKey(new Date('2026-06-19T00:00:00Z'))).toMatch(/^2026-W\d{2}$/);
  });
});

describe('WinbackProcessor', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let campaigns: { validateCoupon: jest.Mock; enqueueBatch: jest.Mock };
  let queue: { add: jest.Mock };

  function build(config: ReturnType<typeof makeConfig>) {
    return new WinbackProcessor(
      prisma as never,
      config as never,
      campaigns as never,
      queue as never,
    );
  }

  beforeEach(() => {
    prisma = makePrisma();
    campaigns = {
      validateCoupon: jest.fn().mockResolvedValue({ type: 'PERCENTAGE', value: 15 }),
      enqueueBatch: jest.fn(),
    };
    queue = { add: jest.fn().mockResolvedValue(undefined) };
  });

  it('registers the weekly cron on init', async () => {
    const proc = build(makeConfig());
    await proc.onModuleInit();
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][2].repeat.pattern).toBeDefined();
    expect(queue.add.mock.calls[0][2].jobId).toBe('campaign-winback-cron');
  });

  it('skips when no win-back coupon is configured', async () => {
    const proc = build(makeConfig({}));
    await proc.process({} as never);
    expect(prisma.campaign.create).not.toHaveBeenCalled();
  });

  it('skips when the configured coupon is not an active promotion', async () => {
    campaigns.validateCoupon.mockRejectedValue(new Error('invalid'));
    const proc = build(makeConfig({ WINBACK_COUPON_CODE: 'GONE' }));
    await proc.process({} as never);
    expect(prisma.campaign.create).not.toHaveBeenCalled();
  });

  it('is idempotent per window (skips when a campaign already exists)', async () => {
    prisma.campaign.findFirst.mockResolvedValue({ id: 'existing' });
    const proc = build(makeConfig({ WINBACK_COUPON_CODE: 'WB15' }));
    await proc.process({} as never);
    expect(prisma.campaign.create).not.toHaveBeenCalled();
    expect(campaigns.enqueueBatch).not.toHaveBeenCalled();
  });

  it('creates a WINBACK campaign and starts the send', async () => {
    const proc = build(makeConfig({ WINBACK_COUPON_CODE: 'WB15' }));
    await proc.process({} as never);
    const data = prisma.campaign.create.mock.calls[0][0].data;
    expect(data.kind).toBe('WINBACK');
    expect(data.segment).toBe('LAPSED');
    expect(data.couponCode).toBe('WB15');
    expect(data.windowKey).toMatch(/^winback:/);
    expect(campaigns.enqueueBatch).toHaveBeenCalledWith('wb1');
  });

  it('materialises the campaign with the shared win-back copy, one locale per store locale', async () => {
    const proc = build(makeConfig({ WINBACK_COUPON_CODE: 'WB15' }));
    await proc.process({} as never);
    const data = prisma.campaign.create.mock.calls[0][0].data;

    // The row carries the shared constants, not an inlined copy of them.
    expect(data.subject).toBe(WINBACK_DEFAULT_SUBJECT);
    expect(data.body).toBe(WINBACK_DEFAULT_BODY);
    for (const locale of DECLARED_LOCALES) {
      expect(data.subject[locale]).toBeTruthy();
      expect(data.body[locale]).toBeTruthy();
    }
    // Each locale is genuinely written, not one language duplicated into both.
    expect(data.subject.fr).not.toBe(data.subject.en);
    expect(data.body.fr).not.toBe(data.body.en);
  });
});

/**
 * The assertions above prove the two locale strings exist and differ, which two
 * different English phrasings would also satisfy, and they never run the copy
 * through the interpolator that a real send uses. This block renders the
 * constants with `render.ts`'s own `interpolate` (D7 exit-audit finding 3).
 */
describe('win-back default copy, rendered through the real interpolator', () => {
  /** Mirrors `CampaignService.discountLabel` for a PERCENTAGE promotion. */
  const DISCOUNT_LABEL = '15%';
  const COUPON_CODE = 'WB15';
  /** Two query params, so the `&` shows which escaping rung the URL took. */
  const SHOP_URL = 'https://storefront.example.test/fr?utm_source=winback&utm_medium=email';

  /** The runtime store name the renderer injects (DR-31). */
  const STORE_NAME = 'Atlas Supplies';

  const VARS = {
    discountLabel: DISCOUNT_LABEL,
    couponCode: COUPON_CODE,
    shopUrl: SHOP_URL,
    storeName: STORE_NAME,
  };

  /**
   * Same marker as `prisma/__tests__/notification-template-defaults.spec.ts`:
   * French function words with no English homograph, or a French diacritic.
   * Either one is enough; neither fires on the English copy.
   */
  const FRENCH_FUNCTION_WORD =
    /\b(le|la|les|de|des|du|un|une|au|aux|votre|vos|vous|nous|est|sont|et|à|pour|sur|dans|avec|par|que|qui|ne|cette|ses|leur|leurs|depuis|chez|dès|selon|entre|vers|sous)\b/i;
  const FRENCH_DIACRITIC = /[éèêëàâäçùûüîïôö]/i;
  const readsAsFrench = (text: string): boolean =>
    FRENCH_FUNCTION_WORD.test(text) || FRENCH_DIACRITIC.test(text);

  it.each([...DECLARED_LOCALES])('%s: the subject substitutes {{discountLabel}}', (locale) => {
    expect(WINBACK_DEFAULT_SUBJECT[locale]).toContain('{{discountLabel}}');

    const subject = interpolate(WINBACK_DEFAULT_SUBJECT[locale], VARS);

    expect(subject).toContain(DISCOUNT_LABEL);
    expect(subject).not.toContain('{{');
    expect(subject).not.toContain('undefined');
    expect(subject).toContain(STORE_NAME);
  });

  it.each([...DECLARED_LOCALES])('%s: the body substitutes every declared token', (locale) => {
    const body = interpolate(WINBACK_DEFAULT_BODY[locale], VARS);

    expect(body).toContain(COUPON_CODE);
    expect(body).toContain(DISCOUNT_LABEL);
    expect(body).toContain(SHOP_URL);
    expect(body).not.toContain('{{');
    expect(body).not.toContain('undefined');
  });

  it.each([...DECLARED_LOCALES])('%s: the CTA url stays raw, the code stays escaped', (locale) => {
    const body = interpolate(WINBACK_DEFAULT_BODY[locale], VARS);

    // `{{{shopUrl}}}` is the raw rung: the `&` between the two query params
    // must survive verbatim inside the href, or the link breaks.
    expect(body).toContain(`href="${SHOP_URL}"`);
    expect(body).not.toContain('&amp;utm_medium');

    // `{{couponCode}}` is the escaped rung, so the same characters are entities.
    const escaped = interpolate(WINBACK_DEFAULT_BODY[locale], {
      ...VARS,
      couponCode: 'WB&15<x>',
    });
    expect(escaped).toContain('WB&amp;15&lt;x&gt;');
    expect(escaped).not.toContain('WB&15<x>');
  });

  // Same rule the file templates are held to in
  // `mail/templates/registry-render.spec.ts`: a noun-phrase heading, with the
  // salutation opening the first sentence rather than standing as the heading.
  it.each([...DECLARED_LOCALES])(
    '%s: heads the body with a noun phrase, not a salutation',
    (locale) => {
      const heading = WINBACK_DEFAULT_BODY[locale].match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.trim();

      expect(heading).toBeTruthy();
      expect(heading).not.toMatch(SALUTATION_ALONE);
    },
  );

  it('renders French for fr and English for en', () => {
    const fr: MailLocale = 'fr';
    const en: MailLocale = 'en';

    expect(readsAsFrench(interpolate(WINBACK_DEFAULT_SUBJECT[fr], VARS))).toBe(true);
    expect(readsAsFrench(interpolate(WINBACK_DEFAULT_BODY[fr], VARS))).toBe(true);
    expect(readsAsFrench(interpolate(WINBACK_DEFAULT_SUBJECT[en], VARS))).toBe(false);
    expect(readsAsFrench(interpolate(WINBACK_DEFAULT_BODY[en], VARS))).toBe(false);
  });
});
