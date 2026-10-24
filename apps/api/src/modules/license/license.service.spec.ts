import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SettingsService } from '../settings/settings.service';
import { LICENSE_FILE_ENV, LICENSE_PUBLIC_KEY_ENV } from './license.constants';
import { LicenseService, hostOf, isBound, scratchPathFor } from './license.service';

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
const PUBLIC_KEY = read('public.pem');

const DEMO_HOSTS = ['demo.example', 'admin.demo.example', 'api.demo.example'];

describe('LicenseService', () => {
  const env: Record<string, string | undefined> = {};
  const settings = {
    writeLicenseVerdict: jest.fn(),
    readLicenseVerdict: jest.fn(async () => ({ status: undefined, claims: undefined })),
  };
  let service: LicenseService;
  let warn: jest.SpyInstance | undefined;

  afterEach(() => {
    warn?.mockRestore();
    warn = undefined;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    for (const key of Object.keys(env)) delete env[key];
    // The override is honoured only under `test` and `development`, so the
    // harness has to say which it is; without it every fixture below would be
    // verified against the baked production key and refused.
    env['NODE_ENV'] = 'test';
    env[LICENSE_PUBLIC_KEY_ENV] = PUBLIC_KEY;
    env['STOREFRONT_PUBLIC_BASE_URL'] = 'https://demo.example';
    env['ADMIN_PUBLIC_BASE_URL'] = 'https://admin.demo.example';
    env['API_PUBLIC_BASE_URL'] = 'https://api.demo.example';
    const module = await Test.createTestingModule({
      providers: [
        LicenseService,
        { provide: ConfigService, useValue: { get: (k: string) => env[k] } },
        { provide: SettingsService, useValue: settings },
      ],
    }).compile();
    service = module.get(LicenseService);
  });

  describe('verify', () => {
    const now = new Date('2026-09-03T12:00:00.000Z');

    it('accepts the fixture license signed by the test key, bound to the demo domains', () => {
      const verdict = service.verify(read('valid.license.json'), DEMO_HOSTS, now);
      expect(verdict.status).toBe('valid');
      expect(verdict.claims).toMatchObject({
        plan: 'studio',
        storeCap: 3,
        licensee: 'Fixture Agency',
      });
      expect(verdict.reason).toBeNull();
      expect(verdict.graceEndsAt).toBeNull();
    });

    it('refuses a license signed by a key the engine does not trust', () => {
      const verdict = service.verify(read('untrusted.license.json'), DEMO_HOSTS, now);
      expect(verdict.status).toBe('invalid');
      expect(verdict.reason).toMatch(/signature/);
      expect(verdict.claims).toBeNull();
    });

    it('refuses claims edited after signing', () => {
      const verdict = service.verify(read('tampered.license.json'), DEMO_HOSTS, now);
      expect(verdict.status).toBe('invalid');
      expect(verdict.reason).toMatch(/signature/);
    });

    it('refuses a license bound to other domains than the store answers on', () => {
      const verdict = service.verify(read('wrong-domain.license.json'), DEMO_HOSTS, now);
      expect(verdict.status).toBe('invalid');
      expect(verdict.reason).toMatch(/bound to other.example/);
      expect(verdict.reason).toMatch(/demo.example/);
    });

    it('passes the domain check on a store with no public origin configured yet', () => {
      expect(service.verify(read('wrong-domain.license.json'), [], now).status).toBe('valid');
    });

    it('refuses a malformed or empty signature without throwing', () => {
      const file = JSON.parse(read('valid.license.json')) as { claims: unknown; signature: string };
      for (const signature of ['', 'AA==', '!!not base64!!', 'QUJD']) {
        const verdict = service.verify(JSON.stringify({ ...file, signature }), DEMO_HOSTS, now);
        expect(verdict.status).toBe('invalid');
      }
    });

    it('refuses malformed JSON and malformed claims without touching the key', () => {
      expect(service.verify('{not json', DEMO_HOSTS, now)).toMatchObject({
        status: 'invalid',
        reason: expect.stringMatching(/not valid JSON/),
      });
      expect(
        service.verify(
          JSON.stringify({ claims: { plan: 'x' }, signature: 'AA==' }),
          DEMO_HOSTS,
          now,
        ),
      ).toMatchObject({ status: 'invalid', reason: expect.stringMatching(/malformed/) });
    });

    it('reports expiring inside the last thirty days, grace after expiry, expired after the grace window', () => {
      const valid = read('valid.license.json');
      // The fixture expires 2099-01-01: twenty days before is expiring.
      expect(service.verify(valid, DEMO_HOSTS, new Date('2098-12-12T00:00:00.000Z')).status).toBe(
        'expiring',
      );
      expect(service.verify(valid, DEMO_HOSTS, new Date('2099-01-15T00:00:00.000Z'))).toMatchObject(
        {
          status: 'grace',
          graceEndsAt: '2099-01-31T00:00:00.000Z',
          daysToExpiry: -14,
        },
      );
      expect(service.verify(valid, DEMO_HOSTS, new Date('2099-03-01T00:00:00.000Z')).status).toBe(
        'expired',
      );
      // The expired fixture (2026-01-01) is past its grace window today.
      expect(service.verify(read('expired.license.json'), DEMO_HOSTS, now).status).toBe('expired');
    });

    it('never rejects on expiry: the claims stay readable for the banner', () => {
      const verdict = service.verify(read('expired.license.json'), DEMO_HOSTS, now);
      expect(verdict.claims?.id).toBe('lic-fixture-expired');
    });
  });

  describe('boot', () => {
    it('reports missing without a file and does not throw outside production', async () => {
      env['NODE_ENV'] = 'test';
      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(settings.writeLicenseVerdict).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'missing' }),
      );
      await expect(service.current()).resolves.toMatchObject({ status: 'missing' });
    });

    it('starts in production without a file, warns and reports missing (DR-34)', async () => {
      env['NODE_ENV'] = 'production';
      delete env[LICENSE_PUBLIC_KEY_ENV];
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await expect(service.onModuleInit()).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no license file configured'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(LICENSE_FILE_ENV));
      expect(settings.writeLicenseVerdict).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'missing' }),
      );
      await expect(service.current()).resolves.toMatchObject({ status: 'missing' });
    });

    it.each([
      ['a path that does not exist', path.join(FIXTURES, 'does-not-exist.json')],
      ['a directory', FIXTURES],
    ])(
      'starts in production when LICENSE_FILE is %s, and warns that it cannot be read',
      async (_label, file) => {
        env['NODE_ENV'] = 'production';
        delete env[LICENSE_PUBLIC_KEY_ENV];
        env[LICENSE_FILE_ENV] = file;
        warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

        await expect(service.onModuleInit()).resolves.toBeUndefined();

        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('the configured license file cannot be read'),
        );
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining(file));
        await expect(service.current()).resolves.toMatchObject({ status: 'missing' });
      },
    );

    it('still refuses to start in production on an invalid file', async () => {
      env['NODE_ENV'] = 'production';
      delete env[LICENSE_PUBLIC_KEY_ENV];
      env[LICENSE_FILE_ENV] = path.join(FIXTURES, 'valid.license.json');
      // Signed by the test key, which production never trusts.
      await expect(service.onModuleInit()).rejects.toThrow(
        /License check failed: license signature/,
      );
    });

    it.each([['production'], ['staging'], ['prod'], ['Production'], [undefined]])(
      'refuses the public key override under NODE_ENV=%s',
      async (label) => {
        // The guard used to refuse only the exact string `production`, so it
        // was honoured under every other label and under none at all. The
        // party who sets NODE_ENV is the licensee, so that shape handed the
        // trust root to whoever starts the container.
        if (label === undefined) delete env['NODE_ENV'];
        else env['NODE_ENV'] = label;
        env[LICENSE_FILE_ENV] = path.join(FIXTURES, 'valid.license.json');

        await expect(service.onModuleInit()).rejects.toThrow(
          /LICENSE_PUBLIC_KEY_PEM is set outside test and development/,
        );
        expect(settings.writeLicenseVerdict).not.toHaveBeenCalled();
      },
    );

    it('verifies against the baked key when the override is not allowed', async () => {
      // Not just refused at boot: ignored at the read. A fixture signed by the
      // test key must not verify under a label that does not permit the
      // override, whatever else the process was started with.
      env['NODE_ENV'] = 'staging';
      delete env[LICENSE_PUBLIC_KEY_ENV];

      const verdict = service.verify(read('valid.license.json'), DEMO_HOSTS, new Date());

      expect(verdict.status).toBe('invalid');
      expect(verdict.reason).toContain('signature');
    });

    it('starts on the valid fixture and persists the verdict', async () => {
      env['NODE_ENV'] = 'test';
      env[LICENSE_FILE_ENV] = path.join(FIXTURES, 'valid.license.json');
      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(settings.writeLicenseVerdict).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'valid',
          claims: expect.objectContaining({ plan: 'studio' }),
        }),
      );
    });

    it('refuses to start on a bad signature, in every environment', async () => {
      env['NODE_ENV'] = 'test';
      env[LICENSE_FILE_ENV] = path.join(FIXTURES, 'untrusted.license.json');
      await expect(service.onModuleInit()).rejects.toThrow(
        /License check failed: license signature/,
      );
    });

    it('refuses to start on a domain mismatch', async () => {
      env['NODE_ENV'] = 'test';
      env[LICENSE_FILE_ENV] = path.join(FIXTURES, 'wrong-domain.license.json');
      await expect(service.onModuleInit()).rejects.toThrow(/bound to other.example/);
    });

    it('starts on an expired license and reports the state, never a cut', async () => {
      env['NODE_ENV'] = 'test';
      env[LICENSE_FILE_ENV] = path.join(FIXTURES, 'expired.license.json');
      await expect(service.onModuleInit()).resolves.toBeUndefined();
      await expect(service.current()).resolves.toMatchObject({ status: 'expired' });
    });

    it('reports an unreadable file as missing, without the path in the reason', async () => {
      env['NODE_ENV'] = 'test';
      env[LICENSE_FILE_ENV] = path.join(FIXTURES, 'does-not-exist.json');
      await expect(service.onModuleInit()).resolves.toBeUndefined();
      await expect(service.current()).resolves.toMatchObject({
        status: 'missing',
        reason: 'the configured license file cannot be read',
      });
    });

    it('writes the verdict only when it differs from the stored one', async () => {
      env['NODE_ENV'] = 'test';
      env[LICENSE_FILE_ENV] = path.join(FIXTURES, 'valid.license.json');
      await service.onModuleInit();
      expect(settings.writeLicenseVerdict).toHaveBeenCalledTimes(1);
      const written = settings.writeLicenseVerdict.mock.calls[0][0];
      settings.readLicenseVerdict.mockResolvedValueOnce({
        status: written.status,
        claims: written.claims,
      });
      await service.current(true);
      expect(settings.writeLicenseVerdict).toHaveBeenCalledTimes(1);
    });

    it('binds to the origins the environment serves, not to a settings row', async () => {
      env['NODE_ENV'] = 'test';
      env['STOREFRONT_PUBLIC_BASE_URL'] = 'https://other.example';
      env[LICENSE_FILE_ENV] = path.join(FIXTURES, 'valid.license.json');
      await expect(service.onModuleInit()).rejects.toThrow(/other.example/);
    });

    it('does not use the baked engine key when the test key override is set, and vice versa', async () => {
      // The fixtures are signed by the test key. Without the override the
      // baked engine key must refuse them: the two keys are never the same.
      delete env[LICENSE_PUBLIC_KEY_ENV];
      env['NODE_ENV'] = 'test';
      env[LICENSE_FILE_ENV] = path.join(FIXTURES, 'valid.license.json');
      await expect(service.onModuleInit()).rejects.toThrow(/signature/);
    });
  });

  it.each([['staging'], ['prod'], [undefined]])(
    'warns without a file under NODE_ENV=%s, because every label outside test and development is production',
    async (label) => {
      if (label === undefined) delete env['NODE_ENV'];
      else env['NODE_ENV'] = label;
      delete env[LICENSE_PUBLIC_KEY_ENV];
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('runs unlicensed'));
    },
  );

  describe('domain binding helpers', () => {
    it('extracts the hostname of an origin, or nothing', () => {
      expect(hostOf('https://admin.shop.example:8443/')).toBe('admin.shop.example');
      expect(hostOf('http://localhost:53300')).toBe('localhost');
      expect(hostOf('')).toBeNull();
      expect(hostOf('not a url')).toBeNull();
    });

    it('lets an apex cover its subdomains and a star cover everything', () => {
      expect(isBound('admin.shop.example', ['shop.example'])).toBe(true);
      expect(isBound('shop.example', ['shop.example'])).toBe(true);
      expect(isBound('shop.example', ['*.shop.example'])).toBe(true);
      expect(isBound('anything.test', ['*'])).toBe(true);
      expect(isBound('shopexample.net', ['shop.example'])).toBe(false);
      expect(isBound('evil-shop.example', ['shop.example'])).toBe(false);
    });
  });

  /**
   * Plan E3.5.4. The install route is the only write in the license module,
   * and its whole security property is an order: verify against the baked key
   * and the configured origins, then write. These cases pin that order from
   * both sides, because a route that writes first and verifies second passes
   * every happy-path test there is.
   */
  describe('install', () => {
    const now = new Date('2026-09-03T12:00:00.000Z');
    let target: string;

    beforeEach(() => {
      target = path.join(os.tmpdir(), `license-install-${Date.now()}-${Math.random()}.json`);
      env[LICENSE_FILE_ENV] = target;
    });

    afterEach(() => {
      fs.rmSync(target, { force: true });
      fs.rmSync(`${target}.incoming`, { force: true });
    });

    it('writes a license that verifies, and returns its verdict', async () => {
      const content = read('valid.license.json');

      const verdict = await service.install(content, now);

      expect(verdict.status).toBe('valid');
      expect(fs.readFileSync(target, 'utf8')).toBe(content);
      expect(settings.writeLicenseVerdict).toHaveBeenCalled();
    });

    it('refuses a file signed by a key the engine does not trust, and writes nothing', async () => {
      await expect(service.install(read('untrusted.license.json'), now)).rejects.toMatchObject({
        response: { error: { code: 'LICENSE_REFUSED' } },
      });

      expect(fs.existsSync(target)).toBe(false);
    });

    it('refuses tampered claims, and writes nothing', async () => {
      await expect(service.install(read('tampered.license.json'), now)).rejects.toMatchObject({
        response: { error: { code: 'LICENSE_REFUSED' } },
      });

      expect(fs.existsSync(target)).toBe(false);
    });

    it('refuses a license bound to somebody else domains, and writes nothing', async () => {
      await expect(service.install(read('wrong-domain.license.json'), now)).rejects.toMatchObject({
        response: { error: { code: 'LICENSE_REFUSED' } },
      });

      expect(fs.existsSync(target)).toBe(false);
    });

    it('names the reason the verdict gave rather than a generic refusal', async () => {
      // Three ways to fail and one message for all of them would leave an
      // operator guessing between a wrong key, a wrong domain and a bad file.
      await expect(service.install(read('wrong-domain.license.json'), now)).rejects.toMatchObject({
        response: { error: { message: expect.stringContaining('bound to') } },
      });
    });

    it('refuses a file that is not JSON at all', async () => {
      await expect(service.install('not json', now)).rejects.toMatchObject({
        response: { error: { code: 'LICENSE_REFUSED' } },
      });

      expect(fs.existsSync(target)).toBe(false);
    });

    it('leaves the previous license in place when the new one is refused', async () => {
      const good = read('valid.license.json');
      await service.install(good, now);

      await expect(service.install(read('untrusted.license.json'), now)).rejects.toThrow();

      expect(fs.readFileSync(target, 'utf8')).toBe(good);
    });

    it('accepts an expired license, because expiry is a banner and not a refusal', async () => {
      // Refusing one would keep an operator from installing the file they were
      // sent, which is the opposite of what a grace period is for.
      const verdict = await service.install(read('expired.license.json'), now);

      expect(verdict.status).not.toBe('invalid');
      expect(fs.existsSync(target)).toBe(true);
    });

    it('names the errno on a write failure and never the path', async () => {
      // Node puts the absolute path in an fs error message, and the exception
      // filter forwards a pre-formatted message verbatim in production. The
      // operator needs to know it was a permission or a full disk, not where
      // the engine keeps its license.
      env[LICENSE_FILE_ENV] = path.join(target, 'nested', 'license.json');

      await expect(service.install(read('valid.license.json'), now)).rejects.toMatchObject({
        response: {
          error: {
            code: 'LICENSE_WRITE_FAILED',
            message: expect.not.stringContaining(target),
          },
        },
      });
    });

    it('refuses when the engine has no license path configured', async () => {
      delete env[LICENSE_FILE_ENV];

      await expect(service.install(read('valid.license.json'), now)).rejects.toMatchObject({
        response: { error: { code: 'LICENSE_FILE_NOT_CONFIGURED' } },
      });
    });

    it('leaves no scratch file behind, so the next boot reads a whole one', async () => {
      await service.install(read('valid.license.json'), now);

      const dir = path.dirname(target);
      const base = path.basename(target);
      const leftovers = fs.readdirSync(dir).filter((name) => name.startsWith(`${base}.incoming`));
      expect(leftovers).toEqual([]);
    });

    it('writes through a scratch path nobody else is using', () => {
      // The scratch path used to be `${LICENSE_FILE}.incoming`, one name for
      // every caller. Two installs cannot interleave inside one process, so the
      // property is asserted on the path rather than through a race a
      // single-process test cannot stage: two API replicas sharing a volume
      // would write the same file, and the rename publishes the mixture.
      const first = scratchPathFor(target);
      const second = scratchPathFor(target);

      expect(first).not.toBe(second);
      expect(first).not.toBe(target);
      expect(first.startsWith(`${target}.incoming.`)).toBe(true);
    });

    it('is the path the install actually writes through', () => {
      // The assertion above proves the helper. Nothing about it proves the
      // install calls it, and a call site that went back to one shared name
      // would pass it forever, so the source is read here. The write and the
      // rename are synchronous, so there is no moment at which a running
      // install can be caught holding its scratch file.
      const source = fs.readFileSync(path.join(__dirname, 'license.service.ts'), 'utf8');
      const start = source.indexOf('async install(');
      const body = source.slice(start, source.indexOf('async verifyInstalled(', start));

      expect(body).toContain('scratchPathFor(file)');
      expect(body).not.toMatch(/`\$\{file\}\.incoming`/);
    });

    it('publishes one whole license, never a mixture', async () => {
      const valid = read('valid.license.json');
      const expired = read('expired.license.json');

      await service.install(valid, now);
      await service.install(expired, now);

      const written = fs.readFileSync(target, 'utf8');
      expect([valid, expired]).toContain(written);
      expect(service.verify(written, ['demo.example'], now).status).not.toBe('invalid');
    });

    it('makes the new verdict the one a later read returns', async () => {
      await service.install(read('valid.license.json'), now);

      await expect(service.current()).resolves.toMatchObject({ status: 'valid' });
    });
  });
});
