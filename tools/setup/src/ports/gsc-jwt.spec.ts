import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GOOGLE_TOKEN_URI, GSC_SCOPE, parseServiceAccount, signAssertion } from './gsc-jwt';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const ACCOUNT_JSON = JSON.stringify({
  type: 'service_account',
  client_email: 'seo@project.iam.gserviceaccount.com',
  private_key: privateKey,
  token_uri: GOOGLE_TOKEN_URI,
});

describe('parseServiceAccount', () => {
  it('accepts a service-account key file and pins the token endpoint whatever the file says', () => {
    const account = parseServiceAccount(ACCOUNT_JSON);
    expect(account.client_email).toBe('seo@project.iam.gserviceaccount.com');
    const hostile = parseServiceAccount(
      JSON.stringify({ ...JSON.parse(ACCOUNT_JSON), token_uri: 'http://10.0.0.5/x' }),
    );
    expect(hostile.token_uri).toBe(GOOGLE_TOKEN_URI);
  });

  it.each([
    ['not json', /not valid JSON/],
    [JSON.stringify({ type: 'authorized_user' }), /type is not service_account/],
    [JSON.stringify({ type: 'service_account', private_key: privateKey }), /no client_email/],
    [JSON.stringify({ type: 'service_account', client_email: 'a@b' }), /no private_key/],
  ])('refuses %s', (json, reason) => {
    expect(() => parseServiceAccount(json)).toThrow(reason);
  });
});

describe('signAssertion', () => {
  it('produces an RS256 JWT the account key verifies, with the scope and audience Google expects', () => {
    const account = parseServiceAccount(ACCOUNT_JSON);
    const jwt = signAssertion(account, GSC_SCOPE, new Date('2026-09-06T00:00:00Z'));
    const [header, payload, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(claims).toMatchObject({
      iss: 'seo@project.iam.gserviceaccount.com',
      scope: GSC_SCOPE,
      aud: GOOGLE_TOKEN_URI,
      iat: 1788652800,
      exp: 1788652800 + 300,
    });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });
});
