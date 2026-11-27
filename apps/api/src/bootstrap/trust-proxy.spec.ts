import { Controller, Get, Module, Req } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { applyTrustProxy, parseTrustProxy } from './trust-proxy';

@Controller('ip-test')
class IpTestController {
  @Get()
  get(@Req() req: Request): { ip: string | undefined } {
    return { ip: req.ip };
  }
}

@Module({ controllers: [IpTestController] })
class IpTestAppModule {}

async function build(env: NodeJS.ProcessEnv): Promise<NestExpressApplication> {
  const moduleFixture = await Test.createTestingModule({
    imports: [IpTestAppModule],
  }).compile();
  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  applyTrustProxy(app, env);
  await app.init();
  return app;
}

describe('parseTrustProxy', () => {
  it('returns undefined when unset or empty', () => {
    expect(parseTrustProxy(undefined)).toBeUndefined();
    expect(parseTrustProxy('  ')).toBeUndefined();
  });

  it('reads booleans', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('reads a hop count as a number', () => {
    expect(parseTrustProxy('2')).toBe(2);
  });

  it('passes names and subnets through as a string', () => {
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
  });
});

describe('applyTrustProxy', () => {
  let app: NestExpressApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('ignores X-Forwarded-For when TRUST_PROXY is unset', async () => {
    app = await build({});
    const res = await request(app.getHttpServer())
      .get('/ip-test')
      .set('X-Forwarded-For', '203.0.113.7')
      .expect(200);
    expect(res.body.ip).not.toBe('203.0.113.7');
  });

  it('reads the client ip from a trusted loopback proxy', async () => {
    app = await build({ TRUST_PROXY: 'loopback' });
    const res = await request(app.getHttpServer())
      .get('/ip-test')
      .set('X-Forwarded-For', '203.0.113.7')
      .expect(200);
    expect(res.body.ip).toBe('203.0.113.7');
  });

  it('takes the entry the trusted proxy added, not one the client sent', async () => {
    app = await build({ TRUST_PROXY: 'loopback' });
    const res = await request(app.getHttpServer())
      .get('/ip-test')
      .set('X-Forwarded-For', '198.51.100.1, 203.0.113.7')
      .expect(200);
    expect(res.body.ip).toBe('203.0.113.7');
  });
});
