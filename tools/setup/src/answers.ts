import { z } from 'zod';
import {
  STORE_CONFIG_BUSINESS_TYPES,
  STORE_CONFIG_FONT_KITS,
  STORE_CONFIG_LOCALES,
  STORE_CONFIG_SYMBOL_POSITIONS,
  STORE_CONFIG_TAX_DISPLAYS,
} from '../../../libs/shared/common/src/store-config-fixtures/store-config-fixture.schema';

/**
 * Everything the stepper asks, in one typed object (plan E4.2).
 *
 * The same shape serves three readers: the prompts fill it one step at a time,
 * `--answers file.json` supplies it whole for a non-interactive run, and the
 * state file persists the non-secret part of it between runs. Every field is
 * optional here because a resumed run holds only the steps it has completed;
 * each step validates what it needs when it runs.
 *
 * Secrets are the fields listed in {@link SECRET_ANSWER_PATHS}. They are read
 * from an answers file and from the environment file the stepper wrote, and
 * never written to the state file.
 */
export const SETUP_PROFILES = ['engine', 'storefront', 'both', 'local'] as const;
export type SetupProfile = (typeof SETUP_PROFILES)[number];

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
/** An optional colour: a hex, null, or the empty string a prompt returns for "none". */
const optionalHex = z.union([hex, z.literal('')]).nullable();
const translatable = z.record(z.string(), z.string());

export const setupAnswersSchema = z
  .object({
    profile: z.enum(SETUP_PROFILES).optional(),
    identity: z
      .object({
        storeName: translatable.optional(),
        brandName: z.string().optional(),
        description: translatable.optional(),
        legalName: translatable.optional(),
        contactEmail: z.string().optional(),
        contactPhone: z.string().optional(),
        street: translatable.optional(),
        locality: z.string().optional(),
        region: z.string().optional(),
        postalCode: z.string().nullable().optional(),
        country: z.string().optional(),
        areaServed: z.array(z.string()).optional(),
        businessType: z.enum(STORE_CONFIG_BUSINESS_TYPES).optional(),
      })
      .optional(),
    domains: z
      .object({
        storefront: z.string().optional(),
        admin: z.string().optional(),
        api: z.string().optional(),
        /** Where certbot sends expiry notices; also the admin's contact for Let's Encrypt. */
        certbotEmail: z.string().optional(),
      })
      .optional(),
    brand: z
      .object({
        primary: hex.optional(),
        secondary: optionalHex.optional(),
        accent: optionalHex.optional(),
        fontKit: z.enum(STORE_CONFIG_FONT_KITS).optional(),
        /** Local path of the logo the runner uploads; empty for none. */
        logoPath: z.string().optional(),
      })
      .optional(),
    localization: z
      .object({
        supportedLocales: z.array(z.enum(STORE_CONFIG_LOCALES)).optional(),
        defaultLocale: z.enum(STORE_CONFIG_LOCALES).optional(),
        rtlLocales: z.array(z.enum(STORE_CONFIG_LOCALES)).optional(),
        timezone: z.string().optional(),
      })
      .optional(),
    money: z
      .object({
        currencyCode: z.string().optional(),
        symbol: z.string().optional(),
        symbolPosition: z.enum(STORE_CONFIG_SYMBOL_POSITIONS).optional(),
        decimalSeparator: z.string().optional(),
        thousandsSeparator: z.string().optional(),
        displayPrecision: z.number().int().min(0).max(3).optional(),
        taxDisplay: z.enum(STORE_CONFIG_TAX_DISPLAYS).optional(),
        /** A fraction: 0.19 for nineteen percent. What the config carries. */
        vatRate: z.number().min(0).max(1).optional(),
        /** What the prompt asks and an answers file says: 19 for nineteen percent. */
        vatPercent: z.number().min(0).max(100).optional(),
        /** The domestic flat shipping rate in the store currency; replaces the seed's placeholder. */
        shippingFlatRate: z.number().min(0).optional(),
      })
      .optional(),
    storage: z
      .object({
        driver: z.enum(['s3', 'local']).optional(),
        endpoint: z.string().optional(),
        region: z.string().optional(),
        bucket: z.string().optional(),
        publicUrl: z.string().optional(),
        accessKey: z.string().optional(),
        secretKey: z.string().optional(),
      })
      .optional(),
    mail: z
      .object({
        transport: z.enum(['resend', 'console']).optional(),
        apiKey: z.string().optional(),
        webhookSecret: z.string().optional(),
        fromEmail: z.string().optional(),
        fromName: z.string().optional(),
        replyTo: z.string().optional(),
        contactFormRecipient: z.string().optional(),
        /** Where every message goes on a local profile. */
        devRedirectTo: z.string().optional(),
        /** The operator address the verification message is sent to. */
        testRecipient: z.string().optional(),
      })
      .optional(),
    turnstile: z
      .object({
        enabled: z.boolean().optional(),
        siteKey: z.string().optional(),
        secretKey: z.string().optional(),
      })
      .optional(),
    seo: z
      .object({
        /** Constrained here too: a storefront-only box writes the key file from the document without the SEO step. */
        indexNowKey: z.union([z.literal(''), z.string().regex(/^[a-f0-9]{8,128}$/)]).optional(),
        bingApiKey: z.string().optional(),
        gscServiceAccountFile: z.string().optional(),
        gscSiteUrl: z.string().optional(),
      })
      .optional(),
    payments: z
      .object({
        cod: z.boolean().optional(),
        stripe: z.boolean().optional(),
        stripeApiKey: z.string().optional(),
        stripeWebhookSecret: z.string().optional(),
        manual: z.boolean().optional(),
      })
      .optional(),
    owner: z
      .object({
        email: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        password: z.string().optional(),
      })
      .optional(),
    demoCatalogue: z.boolean().optional(),
    /** The revalidate secret a storefront-only box takes from the engine box output. */
    engine: z
      .object({
        revalidateSecret: z.string().optional(),
        /** The engine's public API origin the storefront proxies to. */
        apiUrl: z.string().optional(),
      })
      .optional(),
  })
  .strict();

export type SetupAnswers = z.infer<typeof setupAnswersSchema>;

/**
 * Dotted paths of the answers that are secrets. Whatever else the state file
 * keeps, it never keeps these; the environment file, mode 0600, is the only
 * place they live once the stepper has written them.
 */
// The IndexNow key is not here on purpose: it is served at /<key>.txt by
// design, and stripping it from the state file cost a resumed run the file.
export const SECRET_ANSWER_PATHS = [
  'storage.accessKey',
  'storage.secretKey',
  'mail.apiKey',
  'mail.webhookSecret',
  'turnstile.secretKey',
  'seo.bingApiKey',
  'payments.stripeApiKey',
  'payments.stripeWebhookSecret',
  'owner.password',
  'engine.revalidateSecret',
] as const;

export function isSecretPath(path: string): boolean {
  return (SECRET_ANSWER_PATHS as readonly string[]).includes(path);
}

/** Reads a dotted path off a nested object; `undefined` when any segment is missing. */
export function getPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node === null || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[key];
  }, source);
}

/** Writes a dotted path into a nested object, creating the segments it needs. Returns the same object. */
export function setPath<T extends object>(target: T, path: string, value: unknown): T {
  const keys = path.split('.');
  let node = target as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) {
    const next = node[key];
    if (next === null || typeof next !== 'object') node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
  return target;
}

/** A deep copy of the answers with every secret path removed, for the state file. */
export function withoutSecrets(answers: SetupAnswers): SetupAnswers {
  const copy = JSON.parse(JSON.stringify(answers)) as SetupAnswers;
  for (const path of SECRET_ANSWER_PATHS) {
    const keys = path.split('.');
    const parent = getPath(copy, keys.slice(0, -1).join('.')) as
      | Record<string, unknown>
      | undefined;
    if (parent) delete parent[keys[keys.length - 1]];
  }
  return copy;
}

export class AnswersError extends Error {}

/** Keys an answers document written before DR-35 may still carry. */
const LEGACY_ANSWER_KEYS = ['license'] as const;

/** Drops the legacy keys the strict schema would refuse, calling `warn` once per key found. */
export function withoutLegacyKeys(raw: unknown, warn?: (message: string) => void): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const copy = { ...(raw as Record<string, unknown>) };
  for (const key of LEGACY_ANSWER_KEYS) {
    if (!(key in copy)) continue;
    delete copy[key];
    warn?.(`${key}: ignored, the engine runs without one since DR-35`);
  }
  return copy;
}

/** Parses an answers document, naming the first offending field when it does not fit. */
export function parseAnswers(
  raw: unknown,
  source: string,
  warn?: (message: string) => void,
): SetupAnswers {
  const parsed = setupAnswersSchema.safeParse(withoutLegacyKeys(raw, warn));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AnswersError(`${source}: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  return parsed.data;
}
