import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  bingListSites,
  gscListSitemaps,
  jsonRequest,
  localAddresses,
  resendDomain,
  turnstileSecretAccepted,
} from './real';

type Call = { url: string; init?: RequestInit };

function fakeFetch(
  handler: (url: string, init?: RequestInit) => { status: number; body: unknown },
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const { status, body } = handler(url, init);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      statusText: status === 200 ? 'OK' : 'Error',
    });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

describe('jsonRequest', () => {
  it('names the call, the status and the body message on a refusal', async () => {
    const { fetch } = fakeFetch(() => ({ status: 401, body: { message: 'API key is invalid' } }));
    await expect(jsonRequest('https://x', { label: 'Resend domains' }, fetch)).rejects.toThrow(
      'Resend domains: HTTP 401 API key is invalid',
    );
  });
});

describe('resendDomain', () => {
  const domains = { data: [{ name: 'Shop.Example', status: 'verified' }] };

  it('finds the domain case-insensitively and reports its status', async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: domains }));
    await expect(resendDomain('re_key', 'shop.example', fetch)).resolves.toEqual({
      found: true,
      status: 'verified',
    });
    expect(calls[0].init?.headers).toEqual({ Authorization: 'Bearer re_key' });
  });

  it('reports a domain the account does not hold', async () => {
    const { fetch } = fakeFetch(() => ({ status: 200, body: domains }));
    await expect(resendDomain('re_key', 'other.example', fetch)).resolves.toEqual({
      found: false,
      status: null,
    });
  });
});

describe('turnstileSecretAccepted', () => {
  it.each([
    [{ success: false, 'error-codes': ['invalid-input-response'] }, true],
    [{ success: true }, true],
    [{ success: false, 'error-codes': ['invalid-input-secret'] }, false],
    [{ success: false, 'error-codes': ['missing-input-secret'] }, false],
    [{ success: false, 'error-codes': ['internal-error'] }, false],
    [{ success: false, 'error-codes': [] }, false],
  ])('reads %j as accepted=%s', async (body, accepted) => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body }));
    await expect(turnstileSecretAccepted('0x_secret', fetch)).resolves.toBe(accepted);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      secret: '0x_secret',
      response: 'setup-probe',
    });
  });
});

describe('bingListSites', () => {
  it('lists the sites and passes the key as a query parameter', async () => {
    const { fetch, calls } = fakeFetch(() => ({
      status: 200,
      body: { d: [{ Url: 'https://shop.example/' }] },
    }));
    await expect(bingListSites('bing key', fetch)).resolves.toEqual(['https://shop.example/']);
    expect(calls[0].url).toContain('apikey=bing%20key');
  });
});

describe('gscListSitemaps', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const account = JSON.stringify({
    type: 'service_account',
    client_email: 'seo@project.iam.gserviceaccount.com',
    private_key: privateKey,
    token_uri: 'https://oauth2.googleapis.com/token',
  });

  it('exchanges a signed assertion for a token and lists the property sitemaps', async () => {
    const { fetch, calls } = fakeFetch((url) =>
      url.includes('oauth2')
        ? { status: 200, body: { access_token: 'ya29.token' } }
        : { status: 200, body: { sitemap: [{ path: 'https://shop.example/sitemap.xml' }] } },
    );
    await expect(
      gscListSitemaps(account, 'sc-domain:shop.example', fetch, new Date()),
    ).resolves.toEqual(['https://shop.example/sitemap.xml']);
    expect(String(calls[0].init?.body)).toContain(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer',
    );
    expect(calls[1].url).toBe(
      'https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Ashop.example/sitemaps',
    );
    expect(calls[1].init?.headers).toEqual({ Authorization: 'Bearer ya29.token' });
  });

  it('surfaces a property the account cannot see', async () => {
    const { fetch } = fakeFetch((url) =>
      url.includes('oauth2')
        ? { status: 200, body: { access_token: 't' } }
        : { status: 403, body: { error: { message: 'no access' } } },
    );
    await expect(gscListSitemaps(account, 'sc-domain:x', fetch)).rejects.toThrow(
      /Search Console sitemaps: HTTP 403/,
    );
  });
});

describe('localAddresses', () => {
  it('drops loopback and link-local entries', () => {
    expect(
      localAddresses({
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as never],
        eth0: [
          { address: '203.0.113.5', family: 'IPv4', internal: false } as never,
          { address: 'fe80::1', family: 'IPv6', internal: false } as never,
          { address: '2001:db8::5', family: 'IPv6', internal: false } as never,
        ],
      }),
    ).toEqual(['203.0.113.5', '2001:db8::5']);
  });
});
