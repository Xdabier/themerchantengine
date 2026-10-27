import type { SetupAnswers } from '../answers';
import type { GeneratedSecrets } from '../state/secrets';
import type { EnvSection } from './env-file';

/**
 * Composes the environment files the runners write (plan E4.2). One function
 * per file, both pure, so a spec can pin every key an install produces
 * against what the API and the storefront read at boot.
 *
 * Every value that came from the stepper is taken from the answers; every
 * secret from the generated set; every constant from the profile. Nothing is
 * left as a placeholder for a hand edit, because a hand edit is how the
 * previous deploy shipped an unquoted space.
 */
export const ENGINE_PORT = 53000;
export const ADMIN_LOCAL_PORT = 53200;
export const STOREFRONT_PORT = 53300;
export const STOREFRONT_CONTAINER_PORT = 54300;

export const GSC_CONTAINER_PATH = '/app/config/gsc-service-account.json';
export const LOGO_CONTAINER_PATH = '/app/config/invoice-logo.png';

export class ComposeEnvError extends Error {}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new ComposeEnvError(`${what} was never answered`);
  return value;
}

const origins = (answers: SetupAnswers) => {
  const d = need(answers.domains, 'domains');
  return {
    storefront: need(d.storefront, 'domains.storefront'),
    admin: need(d.admin, 'domains.admin'),
    api: need(d.api, 'domains.api'),
  };
};

/** The `.env.production` (or `.env` on a local profile) the api and admin stack reads. */
export function composeEngineEnv(answers: SetupAnswers, secrets: GeneratedSecrets): EnvSection[] {
  const profile = need(answers.profile, 'profile');
  const local = profile === 'local';
  const { storefront, admin, api } = origins(answers);
  const mail = need(answers.mail, 'mail');
  const storage = need(answers.storage, 'storage');
  const turnstile = answers.turnstile ?? { enabled: false };
  const seo = answers.seo ?? {};
  const payments = answers.payments ?? {};

  const sections: EnvSection[] = [
    {
      title: 'Server',
      entries: [
        // A local install runs the containers under `development`: that is the
        // label that unlocks the mail redirect and the loopback throttle
        // bypass. Every server profile is `production`, and so
        // is every label the shared predicate does not recognise.
        { key: 'NODE_ENV', value: local ? 'development' : 'production' },
        { key: 'PORT', value: String(ENGINE_PORT) },
        { key: 'API_GLOBAL_PREFIX', value: 'api' },
        { key: 'LOG_LEVEL', value: local ? 'debug' : 'info' },
      ],
    },
    {
      title: 'Database and cache (compose service names)',
      entries: [
        { key: 'DB_PASSWORD', value: secrets.DB_PASSWORD },
        {
          key: 'DATABASE_URL',
          value: `postgresql://merchants_app:${secrets.DB_PASSWORD}@postgres:5432/merchants_engine?schema=public`,
        },
        { key: 'REDIS_HOST', value: 'redis' },
        { key: 'REDIS_PORT', value: '6379' },
        { key: 'REDIS_PASSWORD', value: secrets.REDIS_PASSWORD },
      ],
    },
    {
      title: 'Auth and origins',
      entries: [
        { key: 'BETTER_AUTH_SECRET', value: secrets.BETTER_AUTH_SECRET },
        {
          key: 'BETTER_AUTH_URL',
          value: api,
          comment: 'The public API origin, used in every callback link inside an email.',
        },
        {
          key: 'CORS_ORIGIN',
          value: [storefront, admin].join(','),
          comment:
            'Also Better Auth trustedOrigins. The admin reaches the API through its own origin.',
        },
        { key: 'STOREFRONT_PUBLIC_BASE_URL', value: storefront },
        { key: 'ADMIN_PUBLIC_BASE_URL', value: admin },
        { key: 'API_PUBLIC_BASE_URL', value: api },
        { key: 'STOREFRONT_REVALIDATE_URL', value: `${storefront}/api/_internal/revalidate` },
        { key: 'STOREFRONT_REVALIDATE_SECRET', value: secrets.STOREFRONT_REVALIDATE_SECRET },
        { key: 'UNSUBSCRIBE_TOKEN_SECRET', value: secrets.UNSUBSCRIBE_TOKEN_SECRET },
        ...(turnstile.enabled && turnstile.secretKey
          ? [{ key: 'TURNSTILE_SECRET', value: turnstile.secretKey }]
          : []),
      ],
    },
    {
      title: 'Uploads and asset storage',
      entries: [
        { key: 'MAX_FILE_SIZE', value: '10485760' },
        { key: 'ALLOWED_FILE_TYPES', value: 'jpg,jpeg,png,gif,pdf,doc,docx' },
        { key: 'STORAGE_DRIVER', value: storage.driver ?? 'local' },
        ...(storage.driver === 's3'
          ? [
              { key: 'S3_ENDPOINT', value: need(storage.endpoint, 'storage.endpoint') },
              { key: 'S3_REGION', value: need(storage.region, 'storage.region') },
              { key: 'S3_BUCKET', value: need(storage.bucket, 'storage.bucket') },
              { key: 'S3_ACCESS_KEY', value: need(storage.accessKey, 'storage.accessKey') },
              { key: 'S3_SECRET_KEY', value: need(storage.secretKey, 'storage.secretKey') },
              { key: 'S3_PUBLIC_URL', value: need(storage.publicUrl, 'storage.publicUrl') },
            ]
          : [{ key: 'UPLOADS_BASE_URL', value: `${api}/uploads` }]),
        { key: 'SIGNED_URL_SECRET', value: secrets.SIGNED_URL_SECRET },
        { key: 'RETAIN_ORIGINALS', value: local ? 'true' : 'false' },
        {
          key: 'INVOICE_LOGO_PATH',
          value: answers.brand?.logoPath ? LOGO_CONTAINER_PATH : '',
        },
      ],
    },
    {
      title: 'Mail',
      entries: [
        { key: 'MAIL_TRANSPORT', value: mail.transport ?? 'console' },
        { key: 'RESEND_API_KEY', value: mail.apiKey ?? '' },
        { key: 'RESEND_WEBHOOK_SECRET', value: mail.webhookSecret ?? '' },
        { key: 'RESEND_FROM_EMAIL', value: need(mail.fromEmail, 'mail.fromEmail') },
        { key: 'RESEND_FROM_NAME', value: need(mail.fromName, 'mail.fromName') },
        { key: 'RESEND_REPLY_TO', value: need(mail.replyTo, 'mail.replyTo') },
        {
          key: 'CONTACT_FORM_RECIPIENT',
          value: need(mail.contactFormRecipient, 'mail.contactFormRecipient'),
        },
        {
          key: 'MAIL_DEV_REDIRECT_TO',
          value: local ? (mail.devRedirectTo ?? '') : '',
          comment:
            'Honoured under NODE_ENV=development only; a production boot refuses a non-empty value.',
        },
      ],
    },
    {
      title: 'Search-engine submission',
      entries: [
        { key: 'INDEXNOW_KEY', value: seo.indexNowKey ?? '' },
        { key: 'BING_API_KEY', value: seo.bingApiKey ?? '' },
        { key: 'BING_SITE_URL', value: seo.bingApiKey ? storefront : '' },
        { key: 'GSC_SUBMISSION_ENABLED', value: seo.gscServiceAccountFile ? 'true' : 'false' },
        { key: 'GSC_SITE_URL', value: seo.gscSiteUrl ?? '' },
        {
          key: 'GOOGLE_APPLICATION_CREDENTIALS',
          value: seo.gscServiceAccountFile ? GSC_CONTAINER_PATH : '',
        },
      ],
    },
    {
      title: 'Payments',
      entries: [
        { key: 'STRIPE_API_KEY', value: payments.stripe ? (payments.stripeApiKey ?? '') : '' },
        {
          key: 'STRIPE_WEBHOOK_SECRET',
          value: payments.stripe ? (payments.stripeWebhookSecret ?? '') : '',
        },
      ],
    },
  ];
  return sections;
}

/** The `apps/storefront/.env.production` the Nitro container reads. */
export function composeStorefrontEnv(
  answers: SetupAnswers,
  secrets: GeneratedSecrets,
): EnvSection[] {
  const profile = need(answers.profile, 'profile');
  const local = profile === 'local';
  const { storefront, api } = origins(answers);
  // On one box the storefront reaches the engine over the compose network; on
  // its own box it goes out over the public API origin.
  const apiTarget =
    profile === 'storefront'
      ? `${need(answers.engine?.apiUrl, 'engine.apiUrl')}/api`
      : `http://api:${ENGINE_PORT}/api`;
  const revalidateSecret =
    profile === 'storefront'
      ? need(answers.engine?.revalidateSecret, 'engine.revalidateSecret')
      : secrets.STOREFRONT_REVALIDATE_SECRET;
  return [
    {
      title: 'Server',
      entries: [
        { key: 'NODE_ENV', value: local ? 'development' : 'production' },
        { key: 'PORT', value: String(STOREFRONT_CONTAINER_PORT) },
        { key: 'HOST', value: '0.0.0.0' },
      ],
    },
    {
      title: 'Engine',
      entries: [
        { key: 'STOREFRONT_API_URL', value: apiTarget },
        { key: 'STOREFRONT_PUBLIC_BASE_URL', value: storefront },
        { key: 'STOREFRONT_REVALIDATE_SECRET', value: revalidateSecret },
        {
          key: 'VITE_TURNSTILE_SITE_KEY',
          value: answers.turnstile?.enabled ? (answers.turnstile.siteKey ?? '') : '',
          comment: 'Read at build time; the runner passes it as a build argument.',
        },
      ],
    },
    {
      title: 'Revalidate dedup store (compose service names)',
      entries: [
        { key: 'REDIS_HOST', value: 'redis' },
        { key: 'REDIS_PORT', value: '6379' },
        {
          key: 'REDIS_PASSWORD',
          value:
            profile === 'storefront' ? secrets.STOREFRONT_REDIS_PASSWORD : secrets.REDIS_PASSWORD,
        },
      ],
    },
    {
      title: 'Public API origin, for links the page builds itself',
      entries: [{ key: 'API_URL', value: `${api}/api` }],
    },
  ];
}
