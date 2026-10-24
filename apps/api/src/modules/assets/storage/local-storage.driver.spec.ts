import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ConfigService } from '@nestjs/config';
import { LocalStorageDriver } from './local-storage.driver';

/**
 * AV0 — covers the visibility split + signUrl plumbing per the
 * `StorageDriver` interface change. Existing public-path writes must keep
 * bit-for-bit-identical behaviour: same on-disk path, same returned URL,
 * because AV0 declares "no observable behaviour change."
 */
describe('LocalStorageDriver', () => {
  let tmpRoot: string;
  let tmpPrivate: string;
  const baseUrl = 'http://localhost:53000/uploads';
  const secret = 'av0-test-signed-url-secret-not-for-prod';

  function buildConfig(env: Record<string, string | undefined>): ConfigService {
    return {
      get: jest.fn((key: string, def?: unknown) => {
        if (key in env) return env[key];
        return def;
      }),
    } as unknown as ConfigService;
  }

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'av0-uploads-'));
    tmpPrivate = await fs.mkdtemp(path.join(os.tmpdir(), 'av0-uploads-private-'));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.rm(tmpPrivate, { recursive: true, force: true });
  });

  function makeDriver(envOverrides: Record<string, string | undefined> = {}) {
    const driver = new LocalStorageDriver(
      buildConfig({
        UPLOADS_BASE_URL: baseUrl,
        PRIVATE_UPLOADS_DIR: tmpPrivate,
        SIGNED_URL_SECRET: secret,
        ...envOverrides,
      }),
    );
    // Inject the tmp uploadsRoot so the spec is hermetic and does not write
    // into the project's real `uploads/` directory. The constructor resolves
    // `process.cwd() + '/uploads'`; we override after construction.
    (driver as unknown as { uploadsRoot: string }).uploadsRoot = tmpRoot;
    return driver;
  }

  // ── save() public visibility ────────────────────────────────────────────────

  describe('save() — public visibility (default)', () => {
    it('writes buffer to UPLOADS root and returns URL with baseUrl', async () => {
      const driver = makeDriver();
      const result = await driver.save(Buffer.from('hello'), 'assets/abc/original.jpg');

      expect(result.storagePath).toBe('assets/abc/original.jpg');
      expect(result.url).toBe(`${baseUrl}/assets/abc/original.jpg`);

      const onDisk = await fs.readFile(path.join(tmpRoot, 'assets/abc/original.jpg'));
      expect(onDisk.toString()).toBe('hello');
    });

    it('explicit visibility: public matches default behaviour', async () => {
      const driver = makeDriver();
      const explicit = await driver.save(Buffer.from('a'), 'assets/x/y.png', {
        visibility: 'public',
      });
      expect(explicit.storagePath).toBe('assets/x/y.png');
      expect(explicit.url).toBe(`${baseUrl}/assets/x/y.png`);
    });

    it('writes under UPLOADS_ROOT when it is set', async () => {
      const driver = new LocalStorageDriver(
        buildConfig({
          UPLOADS_BASE_URL: baseUrl,
          PRIVATE_UPLOADS_DIR: tmpPrivate,
          UPLOADS_ROOT: tmpRoot,
        }),
      );
      await driver.save(Buffer.from('rooted'), 'assets/r/original.jpg');

      const onDisk = await fs.readFile(path.join(tmpRoot, 'assets/r/original.jpg'));
      expect(onDisk.toString()).toBe('rooted');
    });

    it('normalises backslashes in filename', async () => {
      const driver = makeDriver();
      const result = await driver.save(Buffer.from('x'), 'assets\\abc\\thumb.png');
      expect(result.storagePath).toBe('assets/abc/thumb.png');
    });
  });

  // ── save() private visibility ───────────────────────────────────────────────

  describe('save() — private visibility', () => {
    it('writes buffer to PRIVATE_UPLOADS_DIR and returns storagePath with private/ prefix', async () => {
      const driver = makeDriver();
      const result = await driver.save(Buffer.from('secret'), 'assets/abc/original.jpg', {
        visibility: 'private',
      });

      expect(result.storagePath).toBe('private/assets/abc/original.jpg');

      const onDisk = await fs.readFile(path.join(tmpPrivate, 'assets/abc/original.jpg'));
      expect(onDisk.toString()).toBe('secret');
    });

    it('returns empty url for private writes (intentional — no public URL)', async () => {
      const driver = makeDriver();
      const result = await driver.save(Buffer.from('x'), 'assets/y/orig.png', {
        visibility: 'private',
      });
      expect(result.url).toBe('');
    });

    it('does NOT write the file under the public uploads root', async () => {
      const driver = makeDriver();
      await driver.save(Buffer.from('z'), 'assets/abc/original.jpg', { visibility: 'private' });

      await expect(fs.access(path.join(tmpRoot, 'assets/abc/original.jpg'))).rejects.toThrow();
    });
  });

  // ── read() ──────────────────────────────────────────────────────────────────

  describe('read()', () => {
    it('reads a public file from the public uploads root', async () => {
      const driver = makeDriver();
      await driver.save(Buffer.from('public-bytes'), 'assets/abc/file.jpg');
      const buf = await driver.read('assets/abc/file.jpg');
      expect(buf.toString()).toBe('public-bytes');
    });

    it('reads a private file when storagePath carries the private/ prefix', async () => {
      const driver = makeDriver();
      const saved = await driver.save(Buffer.from('private-bytes'), 'assets/abc/orig.jpg', {
        visibility: 'private',
      });
      const buf = await driver.read(saved.storagePath);
      expect(buf.toString()).toBe('private-bytes');
    });
  });

  // ── signUrl() ───────────────────────────────────────────────────────────────

  describe('signUrl()', () => {
    it('returns a URL containing the storagePath, an exp claim, and a signed token', async () => {
      const driver = makeDriver();
      const url = await driver.signUrl('private/assets/abc/original.jpg', 300);
      expect(url).toContain('private/assets/abc/original.jpg');
      expect(url).toMatch(/[?&]exp=\d+/);
      expect(url).toMatch(/[?&]token=[a-f0-9]{64}/);
    });

    it('encodes a TTL claim that equals now + ttlSeconds (within ±2s)', async () => {
      const driver = makeDriver();
      const before = Math.floor(Date.now() / 1000);
      const url = await driver.signUrl('private/foo.jpg', 300);
      const after = Math.floor(Date.now() / 1000);

      const exp = Number(new URL(url).searchParams.get('exp'));
      expect(exp).toBeGreaterThanOrEqual(before + 300 - 2);
      expect(exp).toBeLessThanOrEqual(after + 300 + 2);
    });

    it('different secrets produce different signed tokens (tamper-resistance)', async () => {
      const driver1 = makeDriver({ SIGNED_URL_SECRET: 'secret-one' });
      const driver2 = makeDriver({ SIGNED_URL_SECRET: 'secret-two' });

      // Pin clock so the only varying input is the secret.
      const fixedNow = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
      try {
        const u1 = await driver1.signUrl('private/foo.jpg', 300);
        const u2 = await driver2.signUrl('private/foo.jpg', 300);
        const t1 = new URL(u1).searchParams.get('token');
        const t2 = new URL(u2).searchParams.get('token');
        expect(t1).not.toBe(t2);
      } finally {
        jest.restoreAllMocks();
      }
    });

    it('throws when SIGNED_URL_SECRET is not configured', async () => {
      const driver = makeDriver({ SIGNED_URL_SECRET: undefined });
      await expect(driver.signUrl('private/foo.jpg', 300)).rejects.toThrow(/SIGNED_URL_SECRET/);
    });

    it('refuses to sign a non-private storagePath (signing public paths is meaningless)', async () => {
      const driver = makeDriver();
      await expect(driver.signUrl('assets/abc/file.jpg', 300)).rejects.toThrow(/private/);
    });
  });
});
