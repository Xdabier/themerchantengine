import { Controller, Get, Header, Module } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PublicCacheable } from '@common/decorators';
import { applyCacheControlHardening } from './cache-control-hardening';

@Controller('cache-test')
class CacheTestController {
  @Get('default')
  default(): { ok: boolean } {
    return { ok: true };
  }

  @Get('public-cacheable')
  @PublicCacheable(3600)
  cacheable(): { ok: boolean } {
    return { ok: true };
  }

  @Get('explicit-header')
  @Header('Cache-Control', 'public, max-age=60')
  explicit(): { ok: boolean } {
    return { ok: true };
  }

  @Get('cacheable-varying')
  @PublicCacheable(3600, 'Accept-Language')
  cacheableVarying(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [CacheTestController] })
class CacheTestAppModule {}

describe('applyCacheControlHardening', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [CacheTestAppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    applyCacheControlHardening(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('emits Cache-Control: no-store by default on JSON responses', async () => {
    const res = await request(app.getHttpServer()).get('/cache-test/default');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('honours @PublicCacheable(N) override', async () => {
    const res = await request(app.getHttpServer()).get('/cache-test/public-cacheable');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('honours a raw @Header("Cache-Control", ...) override', async () => {
    const res = await request(app.getHttpServer()).get('/cache-test/explicit-header');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('emits NO ETag header on any response (constitution §3.15-A)', async () => {
    for (const path of [
      '/cache-test/default',
      '/cache-test/public-cacheable',
      '/cache-test/explicit-header',
    ]) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.headers.etag).toBeUndefined();
    }
  });

  it('preserves no-store across 404 error responses too', async () => {
    const res = await request(app.getHttpServer()).get('/cache-test/does-not-exist');
    // Without a route, Express's default 404 handler still runs through our
    // middleware — the no-store default must reach the 404 envelope too,
    // otherwise a cached 404 leaks across sessions / customers.
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers.etag).toBeUndefined();
  });
});

describe('PublicCacheable decorator', () => {
  it('rejects non-positive maxAgeSeconds', () => {
    expect(() => PublicCacheable(0)).toThrow(RangeError);
    expect(() => PublicCacheable(-1)).toThrow(RangeError);
    expect(() => PublicCacheable(1.5)).toThrow(RangeError);
  });

  it('rejects a blank vary header name', () => {
    expect(() => PublicCacheable(3600, '')).toThrow(RangeError);
    expect(() => PublicCacheable(3600, '   ')).toThrow(RangeError);
  });
});

describe('a cacheable response that varies by request header', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [CacheTestAppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    applyCacheControlHardening(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * `public, max-age=N` hands the response to every shared cache between the
   * origin and the reader. If the body was chosen from a request header and
   * the response does not say so, the first reader's copy is served to
   * everyone else for the whole TTL. On this store that means a French
   * llms.txt answering an English crawler.
   */
  it('emits Vary alongside Cache-Control so a shared cache can discriminate', async () => {
    const res = await request(app.getHttpServer()).get('/cache-test/cacheable-varying');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(res.headers['vary']).toBe('Accept-Language');
  });

  /** Opt-in, not blanket: a genuinely invariant surface must not claim to vary,
   * or every shared cache fragments its key for no reason. */
  it('emits no Vary when the endpoint did not ask for one', async () => {
    const res = await request(app.getHttpServer()).get('/cache-test/public-cacheable');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(res.headers['vary']).toBeUndefined();
  });
});
