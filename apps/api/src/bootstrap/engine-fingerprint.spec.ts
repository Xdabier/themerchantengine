import { Controller, Get, Module } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { FingerprintEnv } from '@common/fingerprint';
import { applyEngineFingerprint } from './engine-fingerprint';

@Controller('fingerprint-test')
class FingerprintTestController {
  @Get()
  get(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [FingerprintTestController] })
class FingerprintTestAppModule {}

async function build(env: FingerprintEnv): Promise<NestExpressApplication> {
  const moduleFixture = await Test.createTestingModule({
    imports: [FingerprintTestAppModule],
  }).compile();
  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  applyEngineFingerprint(app, env);
  await app.init();
  return app;
}

describe('applyEngineFingerprint', () => {
  let app: NestExpressApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('sends the engine name and never Express', async () => {
    app = await build({});
    const res = await request(app.getHttpServer()).get('/fingerprint-test').expect(200);
    expect(res.headers['x-powered-by']).toBe('themerchantengine');
  });

  it('adds the major version when asked', async () => {
    app = await build({ TME_FINGERPRINT_VERSION: 'major' });
    const res = await request(app.getHttpServer()).get('/fingerprint-test').expect(200);
    expect(res.headers['x-powered-by']).toBe('themerchantengine 1');
  });

  it('sends no X-Powered-By when TME_FINGERPRINT=off', async () => {
    app = await build({ TME_FINGERPRINT: 'off' });
    const res = await request(app.getHttpServer()).get('/fingerprint-test').expect(200);
    expect(res.headers).not.toHaveProperty('x-powered-by');
  });

  it('sends the header on a 404 too', async () => {
    app = await build({});
    const res = await request(app.getHttpServer()).get('/missing').expect(404);
    expect(res.headers['x-powered-by']).toBe('themerchantengine');
  });
});
