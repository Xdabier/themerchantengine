import { createSign } from 'node:crypto';

/**
 * A Google service-account bearer token, without the googleapis client: the
 * stepper needs exactly one call (a sitemaps list) and that package is the
 * largest thing in the workspace. RS256 over a JWT with the account's own
 * private key, exchanged at the OAuth token endpoint.
 */
export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';

export function parseServiceAccount(json: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('the service-account file is not valid JSON');
  }
  const record = parsed as Record<string, unknown>;
  if (record['type'] !== 'service_account') {
    throw new Error('the file is not a service-account key (type is not service_account)');
  }
  const email = record['client_email'];
  const key = record['private_key'];
  if (typeof email !== 'string' || !email.includes('@')) {
    throw new Error('the service-account file has no client_email');
  }
  if (typeof key !== 'string' || !key.includes('PRIVATE KEY')) {
    throw new Error('the service-account file has no private_key');
  }
  // Pinned, not taken from the file: the file is an input, and the token
  // endpoint is not something an input gets to choose.
  return { client_email: email, private_key: key, token_uri: GOOGLE_TOKEN_URI };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** The signed assertion the token endpoint exchanges for a bearer token. */
export function signAssertion(
  account: ServiceAccountKey,
  scope: string,
  issuedAt: Date,
  lifetimeSeconds = 300,
): string {
  const iat = Math.floor(issuedAt.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope,
      aud: account.token_uri ?? GOOGLE_TOKEN_URI,
      iat,
      exp: iat + lifetimeSeconds,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(account.private_key);
  return `${header}.${payload}.${base64url(signature)}`;
}
