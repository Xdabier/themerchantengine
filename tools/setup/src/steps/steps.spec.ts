import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOCALE_REGISTRY,
  registryLocaleCodes,
} from '../../../../libs/shared/common/src/locale/locale-registry';
import { SECRET_ANSWER_PATHS, type SetupAnswers } from '../answers';
import { DocumentPrompter } from '../cli/prompter';
import type { Output } from '../cli/ui';
import { fakePorts, type FakePorts } from '../ports/fake';
import { COMPLETE_ANSWERS } from '../output/client-config.spec';
import { STEPS, stepsFor } from './index';
import { brandStep } from './brand';
import { demoCatalogueStep } from './demo-catalogue';
import { domainsStep } from './domains';
import { identityStep } from './identity';
import { localizationStep } from './localization';
import { mailStep } from './mail';
import { moneyStep } from './money';
import { CI_SMOKE_OWNER_PASSWORD, ownerStep, passwordPolicy } from './owner';
import { paymentsStep } from './payments';
import { seoStep } from './seo';
import { storageStep } from './storage';
import { summaryStep } from './summary';
import { turnstileStep } from './turnstile';
import { StepFailed, type Step, type StepContext } from './types';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function output(): Output & { text: string } {
  const out = {
    text: '',
    isTTY: false,
    write(chunk: string) {
      out.text += chunk;
    },
  };
  return out;
}

interface Run {
  ctx: StepContext;
  out: Output & { text: string };
  ports: FakePorts;
}

/** Runs one step against a document and fake ports; the answers start from `seed`. */
async function runStep(
  step: Step,
  document: unknown,
  seed: SetupAnswers = {},
  options: { ports?: FakePorts; dryRun?: boolean } = {},
): Promise<Run> {
  const out = output();
  const ports = options.ports ?? fakePorts();
  const ctx: StepContext = {
    answers: JSON.parse(JSON.stringify(seed)),
    prompter: new DocumentPrompter(document),
    out,
    ports,
    root: ROOT,
    dryRun: options.dryRun ?? false,
  };
  await step.run(ctx);
  return { ctx, out, ports };
}

const SERVER_DOC = {
  profile: 'both',
  identity: {
    storeName: { default: 'Atlas' },
    brandName: 'atlas',
    description: { default: 'Shop' },
    legalName: { default: 'Atlas SAS' },
    contactEmail: 'hello@atlas.example',
    contactPhone: '+33100000000',
    street: { default: '1 Rue X' },
    locality: 'Lyon',
    region: 'ARA',
    postalCode: '69001',
    country: 'FR',
    businessType: 'OnlineStore',
  },
  domains: {
    storefront: 'https://atlas.example',
    admin: 'https://admin.atlas.example',
    api: 'https://api.atlas.example',
    certbotEmail: 'ops@atlas.example',
  },
  brand: {
    primary: '#1F4E79',
    secondary: '#F2B441',
    accent: '',
    fontKit: 'latin-rounded',
    logoPath: '',
  },
  localization: { supportedLocales: ['fr', 'en'], defaultLocale: 'fr', timezone: 'Europe/Paris' },
  money: {
    currencyCode: 'EUR',
    symbol: '€',
    symbolPosition: 'after',
    decimalSeparator: ',',
    thousandsSeparator: ' ',
    displayPrecision: 2,
    vatPercent: 20,
    taxDisplay: 'TTC',
    shippingFlatRate: 7,
  },
  storage: {
    endpoint: 'https://s3.gra.example',
    region: 'gra',
    bucket: 'atlas-assets',
    publicUrl: 'https://atlas-assets.s3.gra.example',
    accessKey: 'AK',
    secretKey: 'SK',
  },
  mail: {
    fromEmail: 'noreply@atlas.example',
    fromName: 'Atlas',
    replyTo: 'hello@atlas.example',
    contactFormRecipient: 'hello@atlas.example',
    apiKey: 're_key',
    webhookSecret: 'whsec_key',
    testRecipient: 'ops@atlas.example',
  },
  turnstile: { siteKey: '0xSITEKEY1234', secretKey: '0xSECRETKEY1234' }, // gitleaks:allow
  seo: { indexNowKey: '', bingApiKey: 'bingkey', gscServiceAccountFile: '' },
  payments: { cod: true, manual: false, stripe: false },
  owner: {
    email: 'Owner@Atlas.example',
    firstName: 'Ada',
    lastName: 'Atlas',
    password: 'CorrectHorse9x',
  },
  demoCatalogue: false,
};

describe('every secret is asked through the hidden prompt', () => {
  it('walks every step with a recording prompter and checks the method per secret path', async () => {
    // A secret asked through `text` would be echoed as typed and shown as a
    // [default] on a resumed run. The list of secrets is the answers module's;
    // this walks the real steps rather than trusting each author.
    const asked = new Map<string, string>();
    const record = (method: string, q: { path: string }) => {
      asked.set(q.path, method);
    };
    const base = new DocumentPrompter({
      ...SERVER_DOC,
      seo: { indexNowKey: 'abcdef1234', bingApiKey: 'bingkey', gscServiceAccountFile: '' },
      payments: {
        cod: true,
        manual: false,
        stripe: true,
        stripeApiKey: 'sk_test_1',
        stripeWebhookSecret: 'whsec_1',
      },
      engine: { apiUrl: 'https://api.atlas.example', revalidateSecret: 'c'.repeat(64) },
    });
    const prompter = {
      text: (q: Parameters<typeof base.text>[0]) => (record('text', q), base.text(q)),
      secret: (q: Parameters<typeof base.secret>[0]) => (record('secret', q), base.secret(q)),
      confirm: (q: Parameters<typeof base.confirm>[0]) => (record('confirm', q), base.confirm(q)),
      number: (q: Parameters<typeof base.number>[0]) => (record('number', q), base.number(q)),
      select: <T extends string>(q: Parameters<typeof base.select<T>>[0]) => (
        record('select', q),
        base.select(q)
      ),
      multiSelect: <T extends string>(q: Parameters<typeof base.multiSelect<T>>[0]) => (
        record('multiSelect', q),
        base.multiSelect(q)
      ),
    };
    const ports = fakePorts();
    for (const host of ['atlas.example', 'admin.atlas.example', 'api.atlas.example'])
      ports.hosts.set(host, ['203.0.113.5']);
    for (const profile of ['both', 'storefront'] as const) {
      const ctx: StepContext = {
        answers: { profile },
        prompter,
        out: output(),
        ports,
        root: ROOT,
        dryRun: true,
      };
      for (const step of stepsFor(profile)) {
        if (step.id === 'profile' || step.id === 'summary') continue;
        await step.run(ctx);
      }
    }
    const secretsAsked = [...asked.entries()].filter(([p]) =>
      SECRET_ANSWER_PATHS.includes(p as never),
    );
    expect(secretsAsked.length).toBeGreaterThanOrEqual(8);
    for (const [p, method] of secretsAsked) expect(method, p).toBe('secret');
    // And the canary: a text prompt on a secret path would be caught.
    expect(asked.get('identity.brandName')).toBe('text');
  });
});

describe('stepsFor', () => {
  it('asks a storefront box only what it needs and a local box everything but seo', () => {
    const ids = (profile?: string) => stepsFor(profile).map((s) => s.id);
    expect(ids('storefront')).toEqual(['profile', 'domains', 'storage', 'turnstile', 'summary']);
    expect(ids('local')).toEqual(STEPS.map((s) => s.id).filter((id) => id !== 'seo'));
    expect(ids('engine')).toEqual(STEPS.map((s) => s.id));
    expect(ids(undefined)).toEqual(['profile', 'domains', 'storage', 'turnstile', 'summary']);
  });
});

describe('identityStep', () => {
  it('fills the identity from the document and derives areaServed from the country', async () => {
    const { ctx } = await runStep(identityStep, SERVER_DOC);
    expect(ctx.answers.identity).toMatchObject({
      storeName: { default: 'Atlas' },
      brandName: 'atlas',
      country: 'FR',
      areaServed: ['FR'],
      postalCode: '69001',
      contactPhone: '+33100000000',
    });
  });

  it('refuses a country that is not a code and a phone that is not E.164', async () => {
    await expect(
      runStep(identityStep, {
        ...SERVER_DOC,
        identity: { ...SERVER_DOC.identity, country: 'France' },
      }),
    ).rejects.toThrow(/identity\.country/);
    await expect(
      runStep(identityStep, {
        ...SERVER_DOC,
        identity: { ...SERVER_DOC.identity, contactPhone: '01 00' },
      }),
    ).rejects.toThrow(/E\.164/);
  });
});

describe('domainsStep', () => {
  const resolving = () => {
    const ports = fakePorts();
    for (const host of ['atlas.example', 'admin.atlas.example', 'api.atlas.example']) {
      ports.hosts.set(host, ['203.0.113.5']);
    }
    return ports;
  };

  it('accepts origins that resolve to this box', async () => {
    const { ctx, out } = await runStep(
      domainsStep,
      SERVER_DOC,
      { profile: 'both' },
      { ports: resolving() },
    );
    expect(ctx.answers.domains).toMatchObject({
      storefront: 'https://atlas.example',
      certbotEmail: 'ops@atlas.example',
    });
    expect(out.text).toContain('api.atlas.example resolves to this box');
  });

  it('refuses a host that does not resolve, and one that resolves elsewhere', async () => {
    const ports = resolving();
    ports.hosts.delete('api.atlas.example');
    await expect(runStep(domainsStep, SERVER_DOC, { profile: 'both' }, { ports })).rejects.toThrow(
      /api\.atlas\.example does not resolve/,
    );
    ports.hosts.set('api.atlas.example', ['198.51.100.9']);
    await expect(runStep(domainsStep, SERVER_DOC, { profile: 'both' }, { ports })).rejects.toThrow(
      /resolves to 198\.51\.100\.9 but this box answers on 203\.0\.113\.5/,
    );
  });

  it('checks only the hosts the profile serves, and asks a storefront box for the engine secret', async () => {
    const ports = fakePorts();
    ports.hosts.set('atlas.example', ['203.0.113.5']);
    const doc = {
      ...SERVER_DOC,
      engine: { apiUrl: 'https://api.atlas.example', revalidateSecret: 'd'.repeat(64) },
    };
    const { ctx } = await runStep(domainsStep, doc, { profile: 'storefront' }, { ports });
    expect(ctx.answers.engine).toEqual({
      apiUrl: 'https://api.atlas.example',
      revalidateSecret: 'd'.repeat(64),
    });
    await expect(
      runStep(
        domainsStep,
        { ...doc, engine: { ...doc.engine, revalidateSecret: 'short' } },
        { profile: 'storefront' },
        { ports },
      ),
    ).rejects.toThrow(/64 hex/);
  });

  it('refuses a plain http origin on a server and fills the local origins without asking', async () => {
    await expect(
      runStep(
        domainsStep,
        { domains: { ...SERVER_DOC.domains, api: 'http://api.atlas.example' } },
        { profile: 'engine' },
        { ports: resolving() },
      ),
    ).rejects.toThrow(/https origin/);
    const { ctx } = await runStep(domainsStep, {}, { profile: 'local' });
    expect(ctx.answers.domains).toEqual({
      storefront: 'http://localhost:53300',
      admin: 'http://localhost:53200',
      api: 'http://localhost:53000',
    });
  });
});

describe('brandStep', () => {
  it('previews the palette with a contrast report and records the colours', async () => {
    const { ctx, out } = await runStep(brandStep, SERVER_DOC);
    expect(ctx.answers.brand).toEqual({
      primary: '#1F4E79',
      secondary: '#F2B441',
      accent: null,
      fontKit: 'latin-rounded',
      logoPath: '',
    });
    expect(out.text).toMatch(/--brand-text on --brand-bg: \d+\.\d\d:1/);
    expect(out.text).toContain('#');
  });

  it('refuses a colour that is not hex and a logo path with no file', async () => {
    await expect(
      runStep(brandStep, { brand: { ...SERVER_DOC.brand, primary: 'blue' } }),
    ).rejects.toThrow(/hex colour/);
    await expect(
      runStep(brandStep, { brand: { ...SERVER_DOC.brand, logoPath: 'missing.png' } }),
    ).rejects.toThrow(/no file at missing.png/);
  });

  it('refuses a primary the generator cannot make readable', async () => {
    await expect(
      runStep(brandStep, { brand: { ...SERVER_DOC.brand, primary: '#FFFFFF' } }),
    ).rejects.toThrow(StepFailed);
  });
});

describe('localizationStep', () => {
  it('derives the RTL set and corrects the font kit when Arabic is enabled', async () => {
    const { ctx, out } = await runStep(
      localizationStep,
      {
        localization: {
          supportedLocales: ['ar', 'en'],
          defaultLocale: 'ar',
          timezone: 'Asia/Dubai',
        },
      },
      { brand: { primary: '#1F4E79', fontKit: 'latin-rounded' } },
    );
    expect(ctx.answers.localization).toEqual({
      supportedLocales: ['ar', 'en'],
      defaultLocale: 'ar',
      rtlLocales: ['ar'],
      timezone: 'Asia/Dubai',
    });
    expect(ctx.answers.brand?.fontKit).toBe('arabic-latin');
    expect(out.text).toContain('switched the brand');
  });

  it('lists every registry language with its native name and direction', async () => {
    const asked: { path: string; labels: string[]; initial: unknown }[] = [];
    const inner = new DocumentPrompter({ localization: SERVER_DOC.localization });
    const spy = new Proxy(inner, {
      get(target, prop, receiver) {
        const member = Reflect.get(target, prop, receiver);
        if (prop !== 'multiSelect' && prop !== 'select') return member;
        return (q: { path: string; choices: { label: string }[]; initial?: unknown }) => {
          asked.push({
            path: q.path,
            labels: q.choices.map((c) => c.label),
            initial: q.initial,
          });
          return (member as (x: unknown) => unknown).call(target, q);
        };
      },
    });
    const ctx: StepContext = {
      answers: {},
      prompter: spy,
      out: output(),
      ports: fakePorts(),
      root: ROOT,
      dryRun: false,
    };
    await localizationStep.run(ctx);
    const locales = asked.find((q) => q.path === 'localization.supportedLocales');
    expect(locales?.labels).toEqual(
      registryLocaleCodes().map((code) => {
        const def = LOCALE_REGISTRY[code];
        return `${def.label} (${def.code}, ${def.nativeName}${def.direction === 'rtl' ? ', right-to-left' : ''})`;
      }),
    );
  });

  it('offers every registry language by default', async () => {
    const initials: Record<string, unknown> = {};
    const inner = new DocumentPrompter({ localization: SERVER_DOC.localization });
    const spy = new Proxy(inner, {
      get(target, prop, receiver) {
        const member = Reflect.get(target, prop, receiver);
        if (prop !== 'multiSelect') return member;
        return (q: { path: string; initial?: unknown }) => {
          initials[q.path] = q.initial;
          return (member as (x: unknown) => unknown).call(target, q);
        };
      },
    });
    await localizationStep.run({
      answers: {},
      prompter: spy,
      out: output(),
      ports: fakePorts(),
      root: ROOT,
      dryRun: false,
    });
    expect(initials['localization.supportedLocales']).toEqual(registryLocaleCodes());
  });

  it('refuses a timezone Intl does not know and a default outside the set', async () => {
    await expect(
      runStep(localizationStep, {
        localization: { ...SERVER_DOC.localization, timezone: 'Mars/Olympus' },
      }),
    ).rejects.toThrow(/timezone/);
    await expect(
      runStep(localizationStep, {
        localization: { ...SERVER_DOC.localization, defaultLocale: 'ar' },
      }),
    ).rejects.toThrow(/must be one of fr, en/);
  });
});

describe('moneyStep', () => {
  it('records the currency, converts the percent to a fraction and the shipping rate', async () => {
    const { ctx } = await runStep(moneyStep, SERVER_DOC);
    expect(ctx.answers.money).toEqual({
      currencyCode: 'EUR',
      symbol: '€',
      symbolPosition: 'after',
      decimalSeparator: ',',
      thousandsSeparator: ' ',
      displayPrecision: 2,
      taxDisplay: 'TTC',
      vatRate: 0.2,
      vatPercent: 20,
      shippingFlatRate: 7,
    });
  });

  it('refuses equal separators and a precision above three', async () => {
    await expect(
      runStep(moneyStep, { money: { ...SERVER_DOC.money, thousandsSeparator: ',' } }),
    ).rejects.toThrow(/must differ/);
    await expect(
      runStep(moneyStep, { money: { ...SERVER_DOC.money, displayPrecision: 4 } }),
    ).rejects.toThrow(/0 to 3/);
  });
});

describe('storageStep', () => {
  it('probes the bucket with the entered credentials and path-style off for a plain name', async () => {
    const { ctx, ports } = await runStep(storageStep, SERVER_DOC, { profile: 'both' });
    expect(ctx.answers.storage?.driver).toBe('s3');
    expect(ports.calls).toEqual([
      {
        name: 's3Probe',
        args: [
          {
            endpoint: 'https://s3.gra.example',
            region: 'gra',
            bucket: 'atlas-assets',
            accessKey: 'AK',
            secretKey: 'SK',
            forcePathStyle: false,
          },
        ],
      },
    ]);
  });

  it('fails the step with the probe message and skips the probe on a dry run', async () => {
    const ports = fakePorts();
    ports.failures.s3Probe = 'S3 put failed: AccessDenied';
    await expect(runStep(storageStep, SERVER_DOC, { profile: 'both' }, { ports })).rejects.toThrow(
      /AccessDenied/,
    );
    const dry = await runStep(storageStep, SERVER_DOC, { profile: 'both' }, { dryRun: true });
    expect(dry.ports.calls).toEqual([]);
  });

  it('asks nothing on a local profile', async () => {
    const { ctx, ports } = await runStep(storageStep, {}, { profile: 'local' });
    expect(ctx.answers.storage).toEqual({ driver: 'local' });
    expect(ports.calls).toEqual([]);
  });
});

describe('mailStep', () => {
  it('verifies the sending domain and sends the test message', async () => {
    const { ctx, ports, out } = await runStep(mailStep, SERVER_DOC, {
      profile: 'both',
      identity: { contactEmail: 'hello@atlas.example' },
    });
    expect(ctx.answers.mail?.transport).toBe('resend');
    expect(ports.calls.map((c) => c.name)).toEqual(['resendDomain', 'resendSend']);
    expect(ports.calls[0].args).toEqual(['re_key', 'atlas.example']);
    expect(ports.calls[1].args.slice(0, 3)).toEqual([
      're_key',
      'Atlas <noreply@atlas.example>',
      'ops@atlas.example',
    ]);
    expect(out.text).toContain('test message msg_1 sent');
  });

  it('refuses a domain the account does not hold, or holds unverified', async () => {
    const missing = fakePorts({ resendStatus: { found: false, status: null } });
    await expect(
      runStep(mailStep, SERVER_DOC, { profile: 'both' }, { ports: missing }),
    ).rejects.toThrow(/not a domain in this Resend account/);
    const pending = fakePorts({ resendStatus: { found: true, status: 'pending' } });
    await expect(
      runStep(mailStep, SERVER_DOC, { profile: 'both' }, { ports: pending }),
    ).rejects.toThrow(/pending in Resend, not verified/);
  });

  it('uses the console transport with a redirect on a local profile', async () => {
    const { ctx, ports } = await runStep(
      mailStep,
      { mail: { devRedirectTo: 'me@example.test' } },
      { profile: 'local' },
    );
    expect(ctx.answers.mail).toMatchObject({
      transport: 'console',
      devRedirectTo: 'me@example.test',
    });
    expect(ports.calls).toEqual([]);
  });
});

describe('turnstileStep', () => {
  it('proves the secret against siteverify', async () => {
    const { ctx, ports } = await runStep(turnstileStep, SERVER_DOC, { profile: 'both' });
    expect(ctx.answers.turnstile).toEqual({
      enabled: true,
      siteKey: '0xSITEKEY1234',
      secretKey: '0xSECRETKEY1234', // gitleaks:allow
    });
    expect(ports.calls).toEqual([{ name: 'turnstileSecretAccepted', args: ['0xSECRETKEY1234'] }]);
  });

  it('asks a storefront-only box for the site key alone', async () => {
    const { ctx, ports } = await runStep(
      turnstileStep,
      { turnstile: { siteKey: '0xSITEKEY1234' } },
      { profile: 'storefront' },
    );
    expect(ctx.answers.turnstile).toEqual({ enabled: true, siteKey: '0xSITEKEY1234' });
    expect(ports.calls).toEqual([]);
    const off = await runStep(
      turnstileStep,
      { turnstile: { siteKey: '' } },
      { profile: 'storefront' },
    );
    expect(off.ctx.answers.turnstile).toEqual({ enabled: false, siteKey: '' });
  });

  it('fails when Cloudflare refuses the secret and stays off on a local profile by default', async () => {
    const refused = fakePorts({ turnstileAccepted: false });
    await expect(
      runStep(turnstileStep, SERVER_DOC, { profile: 'both' }, { ports: refused }),
    ).rejects.toThrow(/refused the secret/);
    const { ctx } = await runStep(turnstileStep, {}, { profile: 'local' });
    expect(ctx.answers.turnstile).toEqual({ enabled: false });
  });
});

describe('seoStep', () => {
  it('verifies the Bing key and records the rest', async () => {
    const { ctx, ports } = await runStep(seoStep, SERVER_DOC, { profile: 'both' });
    expect(ctx.answers.seo).toEqual({
      indexNowKey: '',
      bingApiKey: 'bingkey',
      gscServiceAccountFile: '',
      gscSiteUrl: '',
    });
    expect(ports.calls).toEqual([{ name: 'bingListSites', args: ['bingkey'] }]);
  });

  it('verifies a service account by a sitemaps list on the property', async () => {
    const ports = fakePorts();
    ports.files.set(path.join(ROOT, 'sa.json'), '{"type":"service_account"}');
    const doc = {
      ...SERVER_DOC,
      seo: {
        indexNowKey: 'abcdef1234',
        bingApiKey: '',
        gscServiceAccountFile: 'sa.json',
        gscSiteUrl: 'sc-domain:atlas.example',
      },
    };
    const { ctx } = await runStep(
      seoStep,
      doc,
      { profile: 'both', domains: SERVER_DOC.domains },
      { ports },
    );
    expect(ports.calls).toEqual([
      { name: 'gscListSitemaps', args: ['{"type":"service_account"}', 'sc-domain:atlas.example'] },
    ]);
    expect(ctx.answers.seo?.indexNowKey).toBe('abcdef1234');
    ports.failures.gscListSitemaps = 'Search Console sitemaps: HTTP 403 no access';
    await expect(runStep(seoStep, doc, { profile: 'both' }, { ports })).rejects.toThrow(/HTTP 403/);
  });

  it('refuses an IndexNow key that is not hex', async () => {
    await expect(
      runStep(seoStep, { seo: { ...SERVER_DOC.seo, indexNowKey: 'not-hex!' } }),
    ).rejects.toThrow(/hex/);
  });
});

describe('paymentsStep', () => {
  it('keeps cash on delivery on and asks for Stripe secrets only when Stripe is on', async () => {
    const { ctx } = await runStep(paymentsStep, SERVER_DOC);
    expect(ctx.answers.payments).toEqual({
      cod: true,
      manual: false,
      stripe: false,
      stripeApiKey: '',
      stripeWebhookSecret: '',
    });
    const stripe = await runStep(paymentsStep, {
      payments: {
        cod: false,
        manual: false,
        stripe: true,
        stripeApiKey: 'sk_test_1',
        stripeWebhookSecret: 'whsec_1',
      },
    });
    expect(stripe.ctx.answers.payments?.stripeApiKey).toBe('sk_test_1');
    expect(stripe.ctx.answers.payments?.stripeWebhookSecret).toBe('whsec_1');
    await expect(
      runStep(paymentsStep, {
        payments: {
          cod: true,
          manual: false,
          stripe: true,
          stripeApiKey: 'pk_test',
          stripeWebhookSecret: 'whsec_1',
        },
      }),
    ).rejects.toThrow(/sk_live_ or sk_test_/);
  });

  it('refuses a webhook signing secret that does not start with whsec_', async () => {
    await expect(
      runStep(paymentsStep, {
        payments: {
          cod: true,
          manual: false,
          stripe: true,
          stripeApiKey: 'sk_test_1',
          stripeWebhookSecret: 'sk_test_1',
        },
      }),
    ).rejects.toThrow(/whsec_/);
  });

  it('warns when no method is on', async () => {
    const { out } = await runStep(paymentsStep, {
      payments: { cod: false, manual: false, stripe: false },
    });
    expect(out.text).toContain('no payment method enabled');
  });
});

describe('ownerStep', () => {
  it('lower-cases the email and applies the password policy', async () => {
    const { ctx } = await runStep(ownerStep, SERVER_DOC);
    expect(ctx.answers.owner).toEqual({
      email: 'owner@atlas.example',
      firstName: 'Ada',
      lastName: 'Atlas',
      password: 'CorrectHorse9x',
    });
    expect(passwordPolicy('short')).toMatch(/at least 12/);
    expect(passwordPolicy('alllowercase12345')).toMatch(/upper-case/);
    expect(passwordPolicy('CorrectHorse9x')).toBeNull();
    await expect(
      runStep(ownerStep, { owner: { ...SERVER_DOC.owner, password: 'weak' } }),
    ).rejects.toThrow(/at least 12/);
  });

  it('refuses the public CI smoke password on every profile but local', async () => {
    const doc = { owner: { ...SERVER_DOC.owner, password: CI_SMOKE_OWNER_PASSWORD } };
    expect(passwordPolicy(CI_SMOKE_OWNER_PASSWORD)).toBeNull();
    for (const profile of ['engine', 'both', 'storefront'] as const) {
      await expect(runStep(ownerStep, doc, { profile })).rejects.toThrow(
        /ci\/answers\.local\.json/,
      );
    }
    const local = await runStep(ownerStep, doc, { profile: 'local' });
    expect(local.ctx.answers.owner?.password).toBe(CI_SMOKE_OWNER_PASSWORD);
  });
});

describe('demoCatalogueStep and summaryStep', () => {
  it('defaults the demo catalogue on locally and off on a server, and warns on a server yes', async () => {
    const local = await runStep(demoCatalogueStep, {}, { profile: 'local' });
    expect(local.ctx.answers.demoCatalogue).toBe(true);
    const server = await runStep(demoCatalogueStep, {}, { profile: 'engine' });
    expect(server.ctx.answers.demoCatalogue).toBe(false);
    const yes = await runStep(demoCatalogueStep, { demoCatalogue: true }, { profile: 'engine' });
    expect(yes.out.text).toContain('fictional products');
  });

  it('prints every answered group without a secret and refuses on a no', async () => {
    const seed: SetupAnswers = {
      ...COMPLETE_ANSWERS,
      profile: 'both',
      mail: {
        transport: 'resend',
        fromEmail: 'noreply@atlas.example',
        fromName: 'Atlas',
        apiKey: 're_secret_value',
      },
      owner: {
        email: 'o@atlas.example',
        firstName: 'Ada',
        lastName: 'Atlas',
        password: 'CorrectHorse9x',
      },
      storage: {
        driver: 's3',
        bucket: 'atlas-assets',
        endpoint: 'https://s3.gra.example',
        secretKey: 'SK_secret',
      },
    };
    const { out } = await runStep(summaryStep, {}, seed);
    expect(out.text).toContain('store: Atlas (atlas), FR');
    expect(out.text).toContain('owner: Ada Atlas <o@atlas.example>');
    expect(out.text).not.toContain('re_secret_value');
    expect(out.text).not.toContain('SK_secret');
    expect(out.text).not.toContain('CorrectHorse9x');
    await expect(runStep(summaryStep, { confirm: false }, seed)).rejects.toThrow(/not confirmed/);
  });
});
