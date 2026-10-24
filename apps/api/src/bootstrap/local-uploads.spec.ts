import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Controller, Get, Module } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { applyCacheControlHardening } from './cache-control-hardening';
import { serveLocalUploads } from './local-uploads';

@Controller('ping')
class PingController {
  @Get()
  ping(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [PingController] })
class PingAppModule {}

async function boot(
  driver: string | undefined,
  uploadsRoot: string,
  privateRoot = `${uploadsRoot}-private`,
): Promise<NestExpressApplication> {
  const moduleFixture = await Test.createTestingModule({ imports: [PingAppModule] }).compile();
  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  applyCacheControlHardening(app);
  serveLocalUploads(app, { driver, uploadsRoot, privateRoot });
  await app.init();
  return app;
}

describe('serveLocalUploads', () => {
  let base: string;
  let uploadsRoot: string;

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'local-uploads-'));
    uploadsRoot = path.join(base, 'uploads');
    fs.mkdirSync(path.join(uploadsRoot, 'assets', 'abc'), { recursive: true });
    fs.writeFileSync(
      path.join(uploadsRoot, 'assets', 'abc', 'large.webp'),
      Buffer.from('RIFF....WEBP'),
    );
    fs.writeFileSync(
      path.join(uploadsRoot, 'assets', 'abc', 'large.avif'),
      Buffer.from('....ftypavif'),
    );
    // The private root is a sibling of the public one, the way LocalStorageDriver lays them out.
    fs.mkdirSync(path.join(base, 'uploads-private', 'private'), { recursive: true });
    fs.writeFileSync(path.join(base, 'uploads-private', 'private', 'invoice.pdf'), 'secret');
    fs.writeFileSync(path.join(uploadsRoot, '.hidden'), 'dot');
  });

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  describe('with the local driver', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await boot('local', uploadsRoot);
    });

    afterAll(async () => {
      await app.close();
    });

    it('serves a public upload with its content type and a public cache header', async () => {
      const res = await request(app.getHttpServer()).get('/uploads/assets/abc/large.webp');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
      expect(res.headers['cache-control']).toBe('public, max-age=86400');
    });

    it('serves an AVIF variant as image/avif, since nosniff makes the browser block octet-stream', async () => {
      const res = await request(app.getHttpServer()).get('/uploads/assets/abc/large.avif');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/avif');
    });

    it('carries no validator, so a conditional request gets the file and never a 304 (§3.15-A)', async () => {
      const first = await request(app.getHttpServer()).get('/uploads/assets/abc/large.webp');
      expect(first.headers['etag']).toBeUndefined();
      expect(first.headers['last-modified']).toBeUndefined();
      const conditional = await request(app.getHttpServer())
        .get('/uploads/assets/abc/large.webp')
        .set('If-None-Match', 'W/"anything"')
        .set('If-Modified-Since', new Date().toUTCString());
      expect(conditional.status).toBe(200);
      expect(conditional.body.length ?? conditional.text.length).toBeGreaterThan(0);
    });

    it('sets the security headers and a correlation id, because it runs before the Nest middleware', async () => {
      const minted = await request(app.getHttpServer()).get('/uploads/assets/abc/large.webp');
      expect(minted.headers['x-content-type-options']).toBe('nosniff');
      expect(minted.headers['x-frame-options']).toBe('DENY');
      expect(minted.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(minted.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(minted.headers['strict-transport-security']).toContain('max-age=');
      expect(minted.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      const echoed = await request(app.getHttpServer())
        .get('/uploads/assets/abc/large.webp')
        .set('X-Request-Id', 'trace-123');
      expect(echoed.headers['x-request-id']).toBe('trace-123');
    });

    it('never reaches the private root beside the public one', async () => {
      const escaped = await request(app.getHttpServer()).get(
        '/uploads/..%2Fuploads-private/private/invoice.pdf',
      );
      expect(escaped.status).toBe(404);
      const plain = await request(app.getHttpServer()).get(
        '/uploads/../uploads-private/private/invoice.pdf',
      );
      expect(plain.status).toBe(404);
    });

    it('does not list directories or serve dotfiles', async () => {
      expect((await request(app.getHttpServer()).get('/uploads/assets/')).status).toBe(404);
      expect((await request(app.getHttpServer()).get('/uploads/.hidden')).status).toBe(404);
    });

    it('falls through to the API for a missing file so the JSON 404 envelope answers', async () => {
      const res = await request(app.getHttpServer()).get('/uploads/assets/nope.webp');
      expect(res.status).toBe(404);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('leaves every other route on the no-store default', async () => {
      const res = await request(app.getHttpServer()).get('/ping');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('with the s3 driver', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await boot('s3', uploadsRoot);
    });

    afterAll(async () => {
      await app.close();
    });

    it('mounts nothing: the bucket serves the files', async () => {
      const res = await request(app.getHttpServer()).get('/uploads/assets/abc/large.webp');
      expect(res.status).toBe(404);
    });
  });

  it('refuses a private root inside the served root, so originals can never be served', () => {
    const fake = { useStaticAssets: () => undefined } as unknown as NestExpressApplication;
    expect(() =>
      serveLocalUploads(fake, {
        driver: 'local',
        uploadsRoot,
        privateRoot: path.join(uploadsRoot, 'private'),
      }),
    ).toThrow(/inside the public uploads root/);
    expect(() =>
      serveLocalUploads(fake, { driver: 'local', uploadsRoot, privateRoot: uploadsRoot }),
    ).toThrow(/inside the public uploads root/);
  });

  it('treats an unset driver as local, the way StorageModule does', () => {
    const fake = { useStaticAssets: () => undefined } as unknown as NestExpressApplication;
    const privateRoot = `${uploadsRoot}-private`;
    expect(serveLocalUploads(fake, { driver: undefined, uploadsRoot, privateRoot })).toBe(true);
    expect(serveLocalUploads(fake, { driver: 'S3', uploadsRoot, privateRoot })).toBe(false);
  });
});
