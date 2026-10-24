import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response } from 'express';
import request from 'supertest';
import { applyCacheControlHardening } from '../../bootstrap/cache-control-hardening';
import { GeoStorefrontController } from './geo-storefront.controller';
import { FR_EN_LOCALE_SET, NEUTRAL_LOCALE_SET, storeLocales } from '@common/locale';
import { GeoService } from './geo.service';

beforeEach(() => storeLocales.set(FR_EN_LOCALE_SET));
afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

describe('GeoStorefrontController', () => {
  let controller: GeoStorefrontController;
  let mockService: jest.Mocked<GeoService>;
  let mockConfig: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    mockService = {
      getLlmsTxt: jest.fn().mockResolvedValue('# Atlas Supplies'),
      getLlmsFullTxt: jest.fn().mockResolvedValue('# Atlas Supplies\n\n## Products'),
    } as unknown as jest.Mocked<GeoService>;

    mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'STOREFRONT_PUBLIC_BASE_URL') return 'https://atlas.example';
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GeoStorefrontController],
      providers: [
        { provide: GeoService, useValue: mockService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    controller = module.get<GeoStorefrontController>(GeoStorefrontController);
  });

  function fakeReq(acceptLanguage = ''): Request {
    return { headers: { 'accept-language': acceptLanguage } } as unknown as Request;
  }

  function fakeRes(): Response {
    return { send: jest.fn() } as unknown as Response;
  }

  describe('GET /v1/llms.txt', () => {
    it('resolves locale from Accept-Language and passes the public base URL to the service', async () => {
      await controller.getLlmsTxt(fakeReq('en-US,en;q=0.9'), fakeRes());
      expect(mockService.getLlmsTxt).toHaveBeenCalledWith('en', 'https://atlas.example');
    });

    it('falls back to the store default locale when Accept-Language is empty', async () => {
      await controller.getLlmsTxt(fakeReq(''), fakeRes());
      expect(mockService.getLlmsTxt).toHaveBeenCalledWith(
        storeLocales.current().defaultLocale,
        'https://atlas.example',
      );
    });

    it('falls back to the store default locale for an unsupported Accept-Language', async () => {
      await controller.getLlmsTxt(fakeReq('de-DE'), fakeRes());
      expect(mockService.getLlmsTxt).toHaveBeenCalledWith('fr', 'https://atlas.example');
    });
  });

  describe('GET /v1/llms-full.txt', () => {
    it('resolves locale from Accept-Language and delegates to getLlmsFullTxt', async () => {
      await controller.getLlmsFullTxt(fakeReq('fr'), fakeRes());
      expect(mockService.getLlmsFullTxt).toHaveBeenCalledWith('fr', 'https://atlas.example');
    });

    it('forwards en when Accept-Language begins with en', async () => {
      await controller.getLlmsFullTxt(fakeReq('en-GB'), fakeRes());
      expect(mockService.getLlmsFullTxt).toHaveBeenCalledWith('en', 'https://atlas.example');
    });

    it('does not call getLlmsTxt (the short index) when /llms-full.txt is requested', async () => {
      await controller.getLlmsFullTxt(fakeReq('en'), fakeRes());
      expect(mockService.getLlmsTxt).not.toHaveBeenCalled();
    });
  });
});

/**
 * The unit tests above call the handler directly, so they never see a header.
 * Both llms surfaces pick their body from `Accept-Language` and are served
 * `public, max-age=3600`, which is exactly the pair that needs `Vary`: without
 * it the first crawler's language wins the shared cache for the whole hour and
 * every later crawler reads the wrong catalogue under a 200.
 */
describe('GeoStorefrontController cache headers', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [GeoStorefrontController],
      providers: [
        {
          provide: GeoService,
          useValue: {
            getLlmsTxt: jest.fn().mockResolvedValue('# Atlas Supplies'),
            getLlmsFullTxt: jest.fn().mockResolvedValue('# Atlas Supplies'),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('https://atlas.example') },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    applyCacheControlHardening(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  for (const path of ['/v1/llms.txt', '/v1/llms-full.txt']) {
    it(`GET ${path} declares both its cache lifetime and what it varies on`, async () => {
      const res = await request(app.getHttpServer()).get(path).set('Accept-Language', 'en-GB');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=3600');
      expect(res.headers['vary']).toBe('Accept-Language');
    });
  }
});
