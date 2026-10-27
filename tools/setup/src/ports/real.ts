import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import * as dns from 'node:dns/promises';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Ports, ResendDomainStatus, S3ProbeConfig } from '../ports';
import { GSC_SCOPE, parseServiceAccount, signAssertion } from './gsc-jwt';

/** Every non-loopback, non-link-local address on this box's interfaces. */
export function localAddresses(interfaces = os.networkInterfaces()): string[] {
  const out: string[] = [];
  for (const list of Object.values(interfaces)) {
    for (const entry of list ?? []) {
      if (entry.internal) continue;
      if (entry.family === 'IPv6' && entry.address.startsWith('fe80')) continue;
      out.push(entry.address);
    }
  }
  return out;
}

/** One JSON request with a bearer or basic credential; throws with the status and the body's message. */
export async function jsonRequest<T>(
  url: string,
  init: RequestInit & { label: string },
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const response = await fetchImpl(url, init);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message =
      (body &&
        typeof body === 'object' &&
        'message' in body &&
        String((body as { message: unknown }).message)) ||
      (typeof body === 'string' && body.slice(0, 200)) ||
      response.statusText;
    throw new Error(`${init.label}: HTTP ${response.status} ${message}`);
  }
  return body as T;
}

export async function s3Probe(config: S3ProbeConfig): Promise<void> {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    forcePathStyle: config.forcePathStyle,
  });
  const key = `setup-probe/${randomUUID()}.txt`;
  const body = `themerchantengine setup probe ${new Date().toISOString()}`;
  const step = async (name: string, run: () => Promise<unknown>) => {
    try {
      return await run();
    } catch (err) {
      throw new Error(`S3 ${name} failed: ${(err as Error).message}`);
    }
  };
  await step('put', () =>
    client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body })),
  );
  const got = (await step('get', () =>
    client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key })),
  )) as { Body?: { transformToString(): Promise<string> } };
  const read = await got.Body?.transformToString();
  if (read !== body) throw new Error('S3 get returned a different object than the one put');
  await step('delete', () =>
    client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key })),
  );
}

export async function s3Put(
  config: S3ProbeConfig,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    forcePathStyle: config.forcePathStyle,
  });
  const put = (acl: 'public-read' | undefined) =>
    client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(acl ? { ACL: acl } : {}),
      }),
    );
  try {
    await put('public-read');
  } catch (err) {
    // A bucket with ownership enforced (the AWS default since 2023, and some
    // compatible providers) refuses any ACL; there the bucket policy decides
    // what is public, so the object goes up without one.
    if ((err as { name?: string }).name !== 'AccessControlListNotSupported') throw err;
    await put(undefined);
  }
}

export async function resendDomain(
  apiKey: string,
  domain: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResendDomainStatus> {
  const body = await jsonRequest<{ data?: { name: string; status: string }[] }>(
    'https://api.resend.com/domains',
    { headers: { Authorization: `Bearer ${apiKey}` }, label: 'Resend domains' },
    fetchImpl,
  );
  const match = (body.data ?? []).find((d) => d.name.toLowerCase() === domain.toLowerCase());
  return match ? { found: true, status: match.status } : { found: false, status: null };
}

export async function resendSend(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = await jsonRequest<{ id: string }>(
    'https://api.resend.com/emails',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
      label: 'Resend send',
    },
    fetchImpl,
  );
  return body.id;
}

/**
 * Cloudflare answers `invalid-input-secret` for a secret it does not know and
 * `invalid-input-response` for a token it cannot verify. The stepper has no
 * widget to mint a token from, so the second answer is the proof the secret
 * is right: the key was accepted and only the token was refused.
 */
export async function turnstileSecretAccepted(
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const body = await jsonRequest<{ success: boolean; 'error-codes'?: string[] }>(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: secretKey, response: 'setup-probe' }),
      label: 'Turnstile siteverify',
    },
    fetchImpl,
  );
  // An allow-list: only the answer that says "the secret is fine, the token
  // is not" counts. A Cloudflare internal error or a rate limit is not proof.
  if (body.success) return true;
  return (body['error-codes'] ?? []).includes('invalid-input-response');
}

export async function gscListSitemaps(
  serviceAccountJson: string,
  siteUrl: string,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<string[]> {
  const account = parseServiceAccount(serviceAccountJson);
  const assertion = signAssertion(account, GSC_SCOPE, now);
  const token = await jsonRequest<{ access_token: string }>(
    account.token_uri ?? 'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
      label: 'Google token',
    },
    fetchImpl,
  );
  const list = await jsonRequest<{ sitemap?: { path: string }[] }>(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`,
    {
      headers: { Authorization: `Bearer ${token.access_token}` },
      label: 'Search Console sitemaps',
    },
    fetchImpl,
  );
  return (list.sitemap ?? []).map((s) => s.path);
}

export async function bingListSites(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const body = await jsonRequest<{ d?: { Url: string }[] }>(
    `https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=${encodeURIComponent(apiKey)}`,
    { label: 'Bing Webmaster sites' },
    fetchImpl,
  );
  return (body.d ?? []).map((s) => s.Url);
}

export function realPorts(): Ports {
  return {
    now: () => new Date(),
    fileExists: (file) => fs.existsSync(file),
    readFile: (file) => fs.readFileSync(file, 'utf8'),
    async resolveHost(hostname) {
      const [v4, v6] = await Promise.all([
        dns.resolve4(hostname).catch(() => [] as string[]),
        dns.resolve6(hostname).catch(() => [] as string[]),
      ]);
      return [...v4, ...v6];
    },
    async publicAddresses() {
      return localAddresses();
    },
    s3Probe,
    s3Put,
    resendDomain,
    resendSend,
    turnstileSecretAccepted,
    gscListSitemaps,
    bingListSites,
  };
}
