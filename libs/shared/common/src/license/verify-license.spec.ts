import * as fs from 'node:fs';
import * as path from 'node:path';
import { LICENSE_PUBLIC_KEY_PEM } from './public-key';
import { hostOf, isBound, verifyLicenseFile } from './verify-license';

const FIXTURES = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'test',
  'fixtures',
  'license',
);
const read = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const TEST_KEY = read('public.pem');
const DEMO_HOSTS = ['demo.example', 'admin.demo.example', 'api.demo.example'];
const NOW = new Date('2026-09-06T00:00:00Z');

describe('verifyLicenseFile', () => {
  it('accepts the valid fixture against the test key and the demo hosts', () => {
    const verdict = verifyLicenseFile(read('valid.license.json'), DEMO_HOSTS, TEST_KEY, NOW);
    expect(verdict.status).toBe('valid');
    expect(verdict.claims?.plan).toBe('studio');
    expect(verdict.graceEndsAt).toBeNull();
  });

  it('refuses the same file against a key that did not sign it', () => {
    // The canary for the signature check: the baked production key must not
    // accept a fixture signed by the test key.
    const verdict = verifyLicenseFile(
      read('valid.license.json'),
      DEMO_HOSTS,
      LICENSE_PUBLIC_KEY_PEM,
      NOW,
    );
    expect(verdict.status).toBe('invalid');
    expect(verdict.reason).toMatch(/signature/);
  });

  it.each([
    ['tampered.license.json', /signature/],
    ['untrusted.license.json', /signature/],
    ['wrong-domain.license.json', /bound to/],
  ])('refuses %s', (file, reason) => {
    const verdict = verifyLicenseFile(read(file), DEMO_HOSTS, TEST_KEY, NOW);
    expect(verdict.status).toBe('invalid');
    expect(verdict.reason).toMatch(reason);
  });

  it('grades expiry rather than refusing it', () => {
    const expired = verifyLicenseFile(read('expired.license.json'), DEMO_HOSTS, TEST_KEY, NOW);
    expect(['grace', 'expired']).toContain(expired.status);
    expect(expired.claims).not.toBeNull();
    expect(expired.daysToExpiry).toBeLessThan(0);
  });

  it('refuses a host the claims do not bind and names it', () => {
    const verdict = verifyLicenseFile(
      read('valid.license.json'),
      [...DEMO_HOSTS, 'shop.elsewhere.example'],
      TEST_KEY,
      NOW,
    );
    expect(verdict.status).toBe('invalid');
    expect(verdict.reason).toContain('shop.elsewhere.example');
  });

  it('refuses text that is not JSON or not a license', () => {
    expect(verifyLicenseFile('nope', DEMO_HOSTS, TEST_KEY, NOW).reason).toMatch(/not valid JSON/);
    expect(verifyLicenseFile('{"claims":{}}', DEMO_HOSTS, TEST_KEY, NOW).reason).toMatch(
      /malformed/,
    );
  });
});

describe('domain binding helpers', () => {
  it('reads the hostname off an origin', () => {
    expect(hostOf('https://Admin.Shop.example:8443/')).toBe('admin.shop.example');
    expect(hostOf('')).toBeNull();
    expect(hostOf('not a url')).toBeNull();
  });

  it('binds an apex to its subdomains and a star to everything', () => {
    expect(isBound('admin.shop.example', ['shop.example'])).toBe(true);
    expect(isBound('shop.example', ['shop.example'])).toBe(true);
    expect(isBound('shopexample.net', ['shop.example'])).toBe(false);
    expect(isBound('anything.example', ['*'])).toBe(true);
    expect(isBound('a.b.example', ['*.b.example'])).toBe(true);
  });
});
