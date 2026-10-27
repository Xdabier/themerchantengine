import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { SeoStorefrontController } from './seo-storefront.controller';
import { SeoService } from './seo.service';
import { SettingsService } from '../settings/settings.service';
import { SEO_SETTINGS_SERVICE } from './seo.constants';

describe('SeoStorefrontController', () => {
  let controller: SeoStorefrontController;
  let mockSettings: jest.Mocked<SettingsService>;
  let mockSeoService: jest.Mocked<SeoService>;
  let mockConfig: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    mockSeoService = {
      getSitemapIndex: jest.fn().mockResolvedValue('<sitemapindex/>'),
      getProductsSitemap: jest.fn().mockResolvedValue('<urlset/>'),
      getCategoriesSitemap: jest.fn().mockResolvedValue('<urlset/>'),
      getPagesSitemap: jest.fn().mockResolvedValue('<urlset/>'),
      getRobotsTxt: jest.fn().mockResolvedValue('User-agent: *\nAllow: /'),
    } as unknown as jest.Mocked<SeoService>;

    mockSettings = {
      get: jest.fn(),
      getGroup: jest.fn(),
    } as unknown as jest.Mocked<SettingsService>;

    mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'STOREFRONT_PUBLIC_BASE_URL') return 'https://atlas.example';
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SeoStorefrontController],
      providers: [
        { provide: SeoService, useValue: mockSeoService },
        { provide: ConfigService, useValue: mockConfig },
        { provide: SEO_SETTINGS_SERVICE, useValue: mockSettings },
      ],
    }).compile();

    controller = module.get<SeoStorefrontController>(SeoStorefrontController);
  });

  function fakeRes(): Response {
    return { send: jest.fn(), redirect: jest.fn() } as unknown as Response;
  }

  describe('dependency injection', () => {
    it('is defined', () => {
      expect(controller).toBeDefined();
    });

    it('injects SettingsService via the SEO_SETTINGS_SERVICE token', () => {
      const settings = (controller as unknown as { settings: SettingsService }).settings;
      expect(settings).toBe(mockSettings);
    });
  });

  describe('site URL resolution', () => {
    it('passes STOREFRONT_PUBLIC_BASE_URL to SeoService.getSitemapIndex', async () => {
      await controller.getSitemapIndex(fakeRes());
      expect(mockSeoService.getSitemapIndex).toHaveBeenCalledWith('https://atlas.example');
    });

    it('passes the same base URL to robots.txt (regression: was req.host = api.<domain>)', async () => {
      await controller.getRobotsTxt(fakeRes());
      expect(mockSeoService.getRobotsTxt).toHaveBeenCalledWith('https://atlas.example');
    });

    it('exposes /sitemap-pages.xml (was referenced in index but unrouted)', async () => {
      await controller.getPagesSitemap(fakeRes());
      expect(mockSeoService.getPagesSitemap).toHaveBeenCalledWith('https://atlas.example');
    });
  });
});
