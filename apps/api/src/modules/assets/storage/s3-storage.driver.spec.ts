import { ConfigService } from '@nestjs/config';

jest.mock('@aws-sdk/client-s3', () => {
  const send = jest.fn();
  class S3Client {
    send = send;
  }
  class PutObjectCommand {
    constructor(public input: unknown) {}
  }
  class GetObjectCommand {
    constructor(public input: unknown) {}
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, __send: send };
});

jest.mock('@aws-sdk/s3-request-presigner', () => {
  const getSignedUrl = jest.fn();
  return { getSignedUrl, __getSignedUrl: getSignedUrl };
});

import * as awsS3 from '@aws-sdk/client-s3';
import * as presigner from '@aws-sdk/s3-request-presigner';
import { S3StorageDriver } from './s3-storage.driver';

const mockSend = (awsS3 as unknown as { __send: jest.Mock }).__send;
const mockGetSignedUrl = (presigner as unknown as { __getSignedUrl: jest.Mock }).__getSignedUrl;

const ENV: Record<string, string> = {
  S3_ENDPOINT: 'https://s3.rbx.io.cloud.ovh.net',
  S3_REGION: 'rbx',
  S3_BUCKET: 'atlas-store-assets',
  S3_ACCESS_KEY: 'AK',
  S3_SECRET_KEY: 'SK',
  S3_PUBLIC_URL: 'https://atlas-store-assets.s3.rbx.io.cloud.ovh.net',
};

const config = {
  get: jest.fn((k: string) => ENV[k]),
} as unknown as ConfigService;

describe('S3StorageDriver', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockGetSignedUrl.mockReset();
  });

  it('throws when a required env var is missing', () => {
    const partial = {
      get: jest.fn((k: string) => (k === 'S3_BUCKET' ? undefined : ENV[k])),
    } as unknown as ConfigService;
    expect(() => new S3StorageDriver(partial)).toThrow(/S3_BUCKET/);
  });

  it('save() puts object and returns public url', async () => {
    mockSend.mockResolvedValueOnce({});
    const driver = new S3StorageDriver(config);
    const result = await driver.save(Buffer.from('hello'), 'assets/abc/original.jpg');

    expect(result.storagePath).toBe('assets/abc/original.jpg');
    expect(result.url).toBe(
      'https://atlas-store-assets.s3.rbx.io.cloud.ovh.net/assets/abc/original.jpg',
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('save() normalises backslashes and leading slashes', async () => {
    mockSend.mockResolvedValueOnce({});
    const driver = new S3StorageDriver(config);
    const result = await driver.save(Buffer.from('x'), '\\assets\\abc\\thumb.png');
    expect(result.storagePath).toBe('assets/abc/thumb.png');
  });

  it('read() concatenates body chunks into a Buffer', async () => {
    async function* gen() {
      yield Buffer.from('hel');
      yield Buffer.from('lo');
    }
    mockSend.mockResolvedValueOnce({ Body: gen() });
    const driver = new S3StorageDriver(config);
    const buf = await driver.read('assets/abc/original.jpg');
    expect(buf.toString()).toBe('hello');
  });

  it('read() throws when body is empty', async () => {
    mockSend.mockResolvedValueOnce({ Body: undefined });
    const driver = new S3StorageDriver(config);
    await expect(driver.read('missing.jpg')).rejects.toThrow(/empty body/);
  });

  // ── AV0 — visibility split + signUrl ────────────────────────────────────────

  describe('save() — public visibility (default)', () => {
    it('puts object with ACL: public-read at the bucket root', async () => {
      mockSend.mockResolvedValueOnce({});
      const driver = new S3StorageDriver(config);
      await driver.save(Buffer.from('x'), 'assets/abc/original.jpg');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0] as { input: { Key: string; ACL?: string } };
      expect(cmd.input.Key).toBe('assets/abc/original.jpg');
      expect(cmd.input.ACL).toBe('public-read');
    });

    it('explicit visibility: public matches default', async () => {
      mockSend.mockResolvedValueOnce({});
      const driver = new S3StorageDriver(config);
      const result = await driver.save(Buffer.from('x'), 'assets/abc/original.jpg', {
        visibility: 'public',
      });
      expect(result.storagePath).toBe('assets/abc/original.jpg');
      expect(result.url).toBe(
        'https://atlas-store-assets.s3.rbx.io.cloud.ovh.net/assets/abc/original.jpg',
      );
    });
  });

  describe('save() — private visibility', () => {
    it('puts object under the private/ key prefix with no ACL', async () => {
      mockSend.mockResolvedValueOnce({});
      const driver = new S3StorageDriver(config);
      await driver.save(Buffer.from('secret'), 'assets/abc/original.jpg', {
        visibility: 'private',
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0] as { input: { Key: string; ACL?: string } };
      expect(cmd.input.Key).toBe('private/assets/abc/original.jpg');
      expect(cmd.input.ACL).toBeUndefined();
    });

    it('returned storagePath starts with private/', async () => {
      mockSend.mockResolvedValueOnce({});
      const driver = new S3StorageDriver(config);
      const result = await driver.save(Buffer.from('x'), 'assets/abc/original.jpg', {
        visibility: 'private',
      });
      expect(result.storagePath).toBe('private/assets/abc/original.jpg');
    });

    it('returned url is empty for private writes (no public CDN URL)', async () => {
      mockSend.mockResolvedValueOnce({});
      const driver = new S3StorageDriver(config);
      const result = await driver.save(Buffer.from('x'), 'assets/abc/original.jpg', {
        visibility: 'private',
      });
      expect(result.url).toBe('');
    });

    it('does NOT double-prefix when storagePath already has private/', async () => {
      mockSend.mockResolvedValueOnce({});
      const driver = new S3StorageDriver(config);
      // Defensive: callers may pass a path already prefixed with private/.
      // Driver must store at private/<rest>, not private/private/<rest>.
      const result = await driver.save(Buffer.from('x'), 'private/assets/abc/orig.jpg', {
        visibility: 'private',
      });
      expect(result.storagePath).toBe('private/assets/abc/orig.jpg');
      const cmd = mockSend.mock.calls[0][0] as { input: { Key: string } };
      expect(cmd.input.Key).toBe('private/assets/abc/orig.jpg');
    });
  });

  describe('read() — private prefix', () => {
    it('reads private/ prefixed keys verbatim (the prefix is part of the S3 key)', async () => {
      async function* gen() {
        yield Buffer.from('secret');
      }
      mockSend.mockResolvedValueOnce({ Body: gen() });
      const driver = new S3StorageDriver(config);
      const buf = await driver.read('private/assets/abc/orig.jpg');

      expect(buf.toString()).toBe('secret');
      const cmd = mockSend.mock.calls[0][0] as { input: { Key: string } };
      expect(cmd.input.Key).toBe('private/assets/abc/orig.jpg');
    });
  });

  describe('signUrl()', () => {
    it('calls getSignedUrl with GetObjectCommand and the requested ttlSeconds', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://signed.example/url');
      const driver = new S3StorageDriver(config);
      const url = await driver.signUrl('private/assets/abc/orig.jpg', 300);

      expect(url).toBe('https://signed.example/url');
      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
      const [, cmd, opts] = mockGetSignedUrl.mock.calls[0];
      expect((cmd as { input: { Bucket: string; Key: string } }).input.Bucket).toBe(
        'atlas-store-assets',
      );
      expect((cmd as { input: { Bucket: string; Key: string } }).input.Key).toBe(
        'private/assets/abc/orig.jpg',
      );
      expect(opts).toEqual({ expiresIn: 300 });
    });

    it('returns the presigned URL string from the presigner', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://example.com/presigned');
      const driver = new S3StorageDriver(config);
      const url = await driver.signUrl('private/foo.jpg', 60);
      expect(url).toBe('https://example.com/presigned');
    });

    it('refuses to sign a non-private storagePath (parity with LocalStorageDriver)', async () => {
      const driver = new S3StorageDriver(config);
      await expect(driver.signUrl('assets/abc/file.jpg', 300)).rejects.toThrow(/private/);
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });
  });
});
